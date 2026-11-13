-- =====================================================================
-- Bulk delete (multi-select) + remaining spec items:
-- daily absence, manual goods receipt, inventory last update, analytics.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Delete many records of one kind at once — all or nothing.
--    Effects of each record are concatenated (the app merges them for display).
--    A record already removed by an earlier one in the same batch
--    (e.g. an item inside a deleted category) is skipped.
-- ---------------------------------------------------------------------
create or replace function public.delete_records(p_entity text, p_ids uuid[], p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_fx jsonb := '[]'::jsonb;
  v_one jsonb;
  v_done integer := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('effects', '[]'::jsonb, 'count', 0);
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'TOO_MANY_ITEMS' using errcode = '22023';
  end if;
  foreach v_id in array p_ids loop
    begin
      v_one := public.delete_record(p_entity, v_id, p_dry_run);
      v_fx := v_fx || coalesce(v_one, '[]'::jsonb);
      v_done := v_done + 1;
    exception when sqlstate 'P0002' then
      null; -- already gone (deleted together with a parent in this batch)
    end;
  end loop;
  return jsonb_build_object('effects', v_fx, 'count', v_done);
end;
$$;
grant execute on function public.delete_records(text, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Daily workers: a day is recorded as present or absent
-- ---------------------------------------------------------------------
alter table public.attendance add column if not exists absent boolean not null default false;
grant select (absent) on public.attendance to authenticated;

create or replace function public.kiosk_absent(p_employee_id uuid, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_date, (now() at time zone public.restaurant_tz())::date);
  v_start timestamptz := v_day::timestamp at time zone public.restaurant_tz();
  v public.attendance;
begin
  if public.current_user_role() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees_meta where id = p_employee_id and is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.attendance where employee_id = p_employee_id
             and clock_in >= v_start and clock_in < v_start + interval '1 day') then
    raise exception 'ALREADY_RECORDED' using errcode = '22023';
  end if;
  insert into public.attendance (employee_id, clock_in, clock_out, absent)
  values (p_employee_id, v_start, v_start + interval '1 minute', true)
  returning * into v;
  return to_jsonb(v);
end;
$$;
grant execute on function public.kiosk_absent(uuid, date) to authenticated;

-- payroll counts only days actually worked; absences carry no hours
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.compute_payroll(date)'::regprocedure);
  def := replace(def, $r$where employee_id = v_emp.id and clock_in >= v_start and clock_in < v_end
      and (clock_out is not null or v_emp.salary_type::text = 'daily');$r$,
    $r$where employee_id = v_emp.id and clock_in >= v_start and clock_in < v_end and not absent
      and (clock_out is not null or v_emp.salary_type::text = 'daily');$r$);
  if position('and not absent' in def) = 0 then raise exception 'compute_payroll patch failed'; end if;
  execute def;
end;
$$;

-- staff board also says whether a day was marked absent today
create or replace function public.staff_board()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'full_name', e.full_name, 'avatar_url', e.avatar_url, 'position', e.position,
      'daily', e.salary_type::text = 'daily',
      'open_since', (select a.clock_in from public.attendance a where a.employee_id = e.id and a.clock_out is null and not a.absent),
      'absent_today', exists (select 1 from public.attendance a where a.employee_id = e.id and a.absent
        and a.clock_in >= (now() at time zone public.restaurant_tz())::date::timestamp at time zone public.restaurant_tz()),
      'present_today', exists (select 1 from public.attendance a where a.employee_id = e.id and not a.absent
        and a.clock_in >= (now() at time zone public.restaurant_tz())::date::timestamp at time zone public.restaurant_tz())
    ) order by e.full_name), '[]'::jsonb)
  from public.employees_meta e
  where e.is_active and public.current_user_role() is not null
$$;

-- ---------------------------------------------------------------------
-- 3. Manual goods receipt: material, quantity, date, supplier (price only for the owner)
-- ---------------------------------------------------------------------
create or replace function public.receive_goods(p_lines jsonb, p_supplier_id uuid, p_date date, p_notes text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po uuid;
  v_line jsonb;
  v_cost numeric;
  v_costs boolean := public.has_perm('costs');
begin
  perform public.require_role('owner', 'manager', 'inventory', 'cashier');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = '22023';
  end if;
  if p_supplier_id is null then
    raise exception 'SUPPLIER_REQUIRED' using errcode = '22023';
  end if;
  insert into public.purchase_orders (supplier_id, status, notes, expected_date, created_by)
  values (p_supplier_id, 'draft', left(coalesce(p_notes, ''), 500), coalesce(p_date, current_date), auth.uid())
  returning id into v_po;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;
    -- staff never set prices: their lines take the material's current cost
    v_cost := case when v_costs and (v_line ->> 'unit_cost') is not null then greatest((v_line ->> 'unit_cost')::numeric, 0)
                   else (select cost_per_unit from public.ingredients where id = (v_line ->> 'ingredient_id')::uuid) end;
    insert into public.purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost)
    values (v_po, (v_line ->> 'ingredient_id')::uuid, (v_line ->> 'quantity')::numeric, coalesce(v_cost, 0));
  end loop;
  perform public.receive_purchase_order(v_po);
  if p_date is not null and p_date <> (now() at time zone public.restaurant_tz())::date then
    update public.purchase_orders set received_at = (p_date::timestamp + interval '12 hours') at time zone public.restaurant_tz() where id = v_po;
  end if;
  return v_po;
end;
$$;
grant execute on function public.receive_goods(jsonb, uuid, date, text) to authenticated;

-- receive_purchase_order is called by staff through receive_goods; cashiers may receive too
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.receive_purchase_order(uuid)'::regprocedure);
  def := replace(def, $r$public.require_role('owner', 'manager', 'inventory')$r$, $r$public.require_role('owner', 'manager', 'inventory', 'cashier')$r$);
  execute def;
end;
$$;
drop policy if exists suppliers_select_cashier on public.suppliers;
create policy suppliers_select_cashier on public.suppliers for select to authenticated using (public.has_role('cashier'));

-- ---------------------------------------------------------------------
-- 4. Owner analytics assistant: consumption, repeated count differences,
--    materials likely to run out, and a daily report
-- ---------------------------------------------------------------------
create or replace function public.inventory_insights(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(3, least(coalesce(p_days, 14), 90));
begin
  perform public.require_perm('reports');
  return jsonb_build_object(
    'days', v_days,
    -- average daily use from sales and waste, and how long the current stock lasts
    'forecast', coalesce((
      select jsonb_agg(x order by x.days_left nulls last, x.name)
      from (
        select i.id, i.name_ar as name, i.name_he, i.unit, i.quantity, i.min_quantity,
          round(u.used / v_days, 3) as per_day,
          case when u.used > 0 then round(greatest(i.quantity, 0) / (u.used / v_days), 1) end as days_left
        from public.ingredients i
        join (select ingredient_id, sum(-change) as used from public.stock_movements
              where reason in ('sale', 'waste') and change < 0 and created_at >= now() - make_interval(days => v_days)
              group by ingredient_id) u on u.ingredient_id = i.id
        where i.is_active
      ) x
    ), '[]'::jsonb),
    -- materials whose stocktakes keep coming out different from the books
    'repeated_variances', coalesce((
      select jsonb_agg(x order by x.times desc, abs(x.total) desc)
      from (
        select i.id, i.name_ar as name, i.name_he, i.unit, count(*) as times,
          round(sum(ci.counted_quantity - ci.expected_quantity), 3) as total
        from public.stock_count_items ci
        join public.stock_counts c on c.id = ci.stock_count_id and c.status = 'applied'
        join public.ingredients i on i.id = ci.ingredient_id
        where ci.counted_quantity is not null and abs(ci.counted_quantity - ci.expected_quantity) > 0.0005
          and c.applied_at >= now() - interval '120 days'
        group by i.id, i.name_ar, i.name_he, i.unit
        having count(*) >= 2
      ) x
    ), '[]'::jsonb),
    -- consumption expected from recipes vs. what actually left the shelf (sales + waste + count corrections)
    'consumption', coalesce((
      select jsonb_agg(x order by abs(x.gap) desc)
      from (
        select i.id, i.name_ar as name, i.name_he, i.unit,
          round(coalesce(sum(-m.change) filter (where m.reason = 'sale'), 0), 3) as by_recipe,
          round(coalesce(sum(-m.change) filter (where m.reason = 'waste'), 0), 3) as waste,
          round(coalesce(sum(-m.change) filter (where m.reason = 'adjustment'), 0), 3) as gap
        from public.stock_movements m join public.ingredients i on i.id = m.ingredient_id
        where m.created_at >= now() - make_interval(days => v_days)
        group by i.id, i.name_ar, i.name_he, i.unit
        having coalesce(sum(-m.change) filter (where m.reason in ('sale', 'waste', 'adjustment')), 0) <> 0
        order by abs(coalesce(sum(-m.change) filter (where m.reason = 'adjustment'), 0)) desc
        limit 15
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.inventory_insights(integer) to authenticated;

create or replace function public.daily_report(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_date, (now() at time zone public.restaurant_tz())::date);
  v_s timestamptz := v_day::timestamp at time zone public.restaurant_tz();
  v_e timestamptz := (v_day + 1)::timestamp at time zone public.restaurant_tz();
  v_avg numeric;
begin
  perform public.require_perm('reports');
  select coalesce(avg(t), 0) into v_avg from (
    select sum(total) t from public.orders
    where status not in ('cancelled', 'refunded') and created_at >= v_s - interval '28 days' and created_at < v_s
    group by public.local_date(created_at)) d;
  return jsonb_build_object(
    'date', v_day,
    'sales', (select coalesce(sum(total), 0) from public.orders where status not in ('cancelled', 'refunded') and created_at >= v_s and created_at < v_e),
    'orders', (select count(*) from public.orders where status not in ('cancelled', 'refunded') and created_at >= v_s and created_at < v_e),
    'avg_day_sales', round(v_avg, 2),
    'cancelled', (select count(*) from public.orders where status in ('cancelled', 'refunded') and created_at >= v_s and created_at < v_e),
    'unpaid', (select coalesce(sum(total - paid_amount), 0) from public.orders where status not in ('cancelled', 'refunded') and payment_status <> 'paid' and created_at >= v_s and created_at < v_e),
    'discounts', (select coalesce(sum(discount_amount), 0) from public.orders where status not in ('cancelled', 'refunded') and created_at >= v_s and created_at < v_e),
    'expenses', (select coalesce(sum(amount), 0) from public.expenses where expense_date = v_day),
    'cogs', case when public.has_perm('costs') then (select coalesce(sum(cost_total), 0) from public.orders where status not in ('cancelled', 'refunded') and created_at >= v_s and created_at < v_e) end,
    'top_items', coalesce((select jsonb_agg(x) from (
        select oi.name_snapshot as name, sum(oi.quantity) qty from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.status not in ('cancelled', 'refunded') and oi.voided_at is null and o.created_at >= v_s and o.created_at < v_e
        group by oi.name_snapshot order by qty desc limit 5) x), '[]'::jsonb),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('name', name_ar, 'quantity', quantity, 'unit', unit, 'min', min_quantity))
        from public.ingredients where is_active and quantity <= min_quantity), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(x) from (
        select e.full_name as name, round(sum(extract(epoch from (coalesce(a.clock_out, now()) - a.clock_in)) / 3600), 1) as hours
        from public.attendance a join public.employees_meta e on e.id = a.employee_id
        where not a.absent and a.clock_in >= v_s and a.clock_in < v_e group by e.full_name order by hours desc) x), '[]'::jsonb),
    'absent', coalesce((select jsonb_agg(e.full_name) from public.attendance a join public.employees_meta e on e.id = a.employee_id
        where a.absent and a.clock_in >= v_s and a.clock_in < v_e), '[]'::jsonb),
    'advances', (select coalesce(sum(amount), 0) from public.salary_advances where created_at >= v_s and created_at < v_e)
  );
end;
$$;
grant execute on function public.daily_report(date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Owner dashboard: expenses today and who is on shift
-- ---------------------------------------------------------------------
create or replace function public.dashboard_extra()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone public.restaurant_tz())::date;
begin
  perform public.require_perm('reports');
  return jsonb_build_object(
    'expenses_today', (select coalesce(sum(amount), 0) from public.expenses where expense_date = v_today),
    'unpaid_orders', (select count(*) from public.orders where status not in ('cancelled', 'refunded') and payment_status <> 'paid'),
    'printers', (select count(*) from public.printers where is_active),
    'on_shift', coalesce((select jsonb_agg(jsonb_build_object('name', e.full_name, 'avatar_url', e.avatar_url, 'since', a.clock_in) order by a.clock_in)
        from public.attendance a join public.employees_meta e on e.id = a.employee_id
        where a.clock_out is null and not a.absent), '[]'::jsonb),
    'forgot_clock_out', (select count(*) from public.attendance where clock_out is null and not absent and clock_in < now() - interval '14 hours'),
    'activity', coalesce((select jsonb_agg(x) from (
        select l.action, l.entity, l.details, l.created_at, p.full_name as by
        from public.audit_log l left join public.profiles p on p.id = l.user_id
        order by l.created_at desc limit 8) x), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.dashboard_extra() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Report sections (period → figures). All need the 'reports' grant;
--    the staff section needs 'employees'.
-- ---------------------------------------------------------------------
create or replace function public.report_orders(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
begin
  perform public.require_perm('reports');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'count', c, 'total', t))
      from (select status, count(*) c, sum(total) t from public.orders where created_at >= v_s and created_at < v_e group by status) x), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'count', c, 'total', t))
      from (select type, count(*) c, sum(total) t from public.orders where created_at >= v_s and created_at < v_e
            and status not in ('cancelled', 'refunded') group by type) x), '[]'::jsonb),
    'avg_ready_minutes', (select round(avg(extract(epoch from (ready_at - created_at)) / 60)::numeric, 1)
      from public.orders where created_at >= v_s and created_at < v_e and ready_at is not null),
    'cancelled', (select count(*) from public.orders where created_at >= v_s and created_at < v_e and status = 'cancelled'),
    'cancelled_total', (select coalesce(sum(total), 0) from public.orders where created_at >= v_s and created_at < v_e and status = 'cancelled'),
    'refunded', (select count(*) from public.orders where created_at >= v_s and created_at < v_e and status = 'refunded'),
    'refunded_total', (select coalesce(sum(total), 0) from public.orders where created_at >= v_s and created_at < v_e and status = 'refunded'),
    'voided_items', (select coalesce(sum(oi.quantity), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
      where o.created_at >= v_s and o.created_at < v_e and oi.voided_at is not null),
    'voids', coalesce((select jsonb_agg(x order by x.at desc) from (
      select o.id, o.order_number, o.total, o.status, o.void_reason as reason, o.voided_at as at, p.full_name as by
      from public.orders o left join public.profiles p on p.id = o.voided_by
      where o.created_at >= v_s and o.created_at < v_e and o.status in ('cancelled', 'refunded')
      order by o.voided_at desc limit 200) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_payments(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
begin
  perform public.require_perm('reports');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'count', c, 'refunds', r))
      from (select p.method, sum(p.amount) filter (where p.amount > 0) amt, count(*) filter (where p.amount > 0) c,
                   coalesce(-sum(p.amount) filter (where p.amount < 0), 0) r
            from public.payments p where p.created_at >= v_s and p.created_at < v_e group by p.method) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', payment_status, 'count', c, 'total', t, 'due', d))
      from (select payment_status, count(*) c, sum(total) t, sum(total - paid_amount) d from public.orders
            where created_at >= v_s and created_at < v_e and status not in ('cancelled', 'refunded') group by payment_status) x), '[]'::jsonb),
    'change_given', (select coalesce(sum(change_given), 0) from public.payments where created_at >= v_s and created_at < v_e),
    'unpaid', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select o.id, o.order_number, o.total, o.paid_amount, o.payment_status, o.customer_name, o.customer_phone, o.created_at
      from public.orders o where o.created_at >= v_s and o.created_at < v_e
        and o.status not in ('cancelled', 'refunded') and o.payment_status <> 'paid' limit 300) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_tax(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
begin
  perform public.require_perm('reports');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'rate', (select vat_percent from public.restaurant_settings limit 1),
    'gross', (select coalesce(sum(total), 0) from public.orders where created_at >= v_s and created_at < v_e and status not in ('cancelled', 'refunded')),
    'vat', (select coalesce(sum(vat_amount), 0) from public.orders where created_at >= v_s and created_at < v_e and status not in ('cancelled', 'refunded')),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'gross', g, 'vat', v, 'orders', c) order by d)
      from (select public.local_date(created_at) d, sum(total) g, sum(vat_amount) v, count(*) c from public.orders
            where created_at >= v_s and created_at < v_e and status not in ('cancelled', 'refunded') group by 1) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_purchases(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
  v_costs boolean := public.has_perm('costs');
begin
  perform public.require_perm('reports');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'costs_visible', v_costs,
    'by_supplier', coalesce((select jsonb_agg(x order by x.orders desc) from (
      select s.id, s.name, s.phone, count(po.id) as orders,
        count(po.id) filter (where po.status = 'received') as received,
        case when v_costs then coalesce(sum(po.total) filter (where po.status = 'received'), 0) end as total
      from public.suppliers s join public.purchase_orders po on po.supplier_id = s.id
      where po.created_at >= v_s and po.created_at < v_e
      group by s.id, s.name, s.phone) x), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select po.id, po.po_number, po.status, po.created_at, po.received_at, s.name as supplier,
        (select count(*) from public.purchase_order_items i where i.purchase_order_id = po.id) as lines,
        case when v_costs then po.total end as total
      from public.purchase_orders po left join public.suppliers s on s.id = po.supplier_id
      where po.created_at >= v_s and po.created_at < v_e limit 300) x), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(x order by x.quantity desc) from (
      select i.name_ar as name, i.unit, round(sum(pi.quantity), 3) as quantity,
        case when v_costs then round(sum(pi.quantity * pi.unit_cost), 2) end as total
      from public.purchase_order_items pi
      join public.purchase_orders po on po.id = pi.purchase_order_id and po.status = 'received'
      join public.ingredients i on i.id = pi.ingredient_id
      where po.received_at >= v_s and po.received_at < v_e
      group by i.name_ar, i.unit) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_cash(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
begin
  perform public.require_perm('reports');
  perform public.check_range(p_from, p_to);
  return coalesce((select jsonb_agg(x order by x.opened_at desc) from (
    select s.id, s.opened_at, s.closed_at, s.opening_float, p.full_name as cashier,
      m.cash, m.card, m.advances,
      coalesce(s.expected_cash, s.opening_float + m.cash - m.advances) as expected,
      s.counted_cash as counted,
      case when s.counted_cash is not null then s.counted_cash - coalesce(s.expected_cash, s.opening_float + m.cash - m.advances) end as variance
    from public.cash_shifts s
    left join public.profiles p on p.id = s.cashier_id
    cross join lateral public.shift_cash(s.id) m
    where s.opened_at >= v_s and s.opened_at < v_e) x), '[]'::jsonb);
end;
$$;

create or replace function public.report_staff(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
begin
  perform public.require_perm('employees');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'employees', coalesce((select jsonb_agg(x order by x.name) from (
      select e.id, e.full_name as name, e.position, e.salary_type, e.salary_amount,
        coalesce(round(sum(extract(epoch from (coalesce(a.clock_out, now()) - a.clock_in)) / 3600) filter (where not a.absent)::numeric, 2), 0) as hours,
        count(distinct public.local_date(a.clock_in)) filter (where not a.absent) as days,
        count(*) filter (where a.absent) as absences,
        (select coalesce(sum(amount), 0) from public.salary_advances sa where sa.employee_id = e.id and sa.created_at >= v_s and sa.created_at < v_e) as advances,
        (select coalesce(sum(net_amount), 0) from public.payroll pr where pr.employee_id = e.id
           and pr.period_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date) as payroll,
        (select coalesce(sum(net_amount), 0) from public.payroll pr where pr.employee_id = e.id and pr.status = 'paid'
           and pr.paid_at >= v_s and pr.paid_at < v_e) as paid
      from public.employees_meta e
      left join public.attendance a on a.employee_id = e.id and a.clock_in >= v_s and a.clock_in < v_e
      group by e.id) x), '[]'::jsonb),
    'advances', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select sa.id, sa.amount, sa.note, sa.created_at, e.full_name as employee, p.full_name as by
      from public.salary_advances sa join public.employees_meta e on e.id = sa.employee_id
      left join public.profiles p on p.id = sa.created_by
      where sa.created_at >= v_s and sa.created_at < v_e) x), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.report_orders(date, date), public.report_payments(date, date), public.report_tax(date, date),
  public.report_purchases(date, date), public.report_cash(date, date), public.report_staff(date, date) to authenticated;
