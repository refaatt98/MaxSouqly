-- =====================================================================
-- Staff meals: the cashier picks an employee and rings up what they eat.
-- Stock is deducted and the cost is recorded as usual, but the order has no
-- sale value: it never counts as sales, cash or tax, and it is never paid.
-- The menu value of each line is kept in order_items.staff_price for reports.
-- =====================================================================

alter table public.orders add column if not exists staff_employee_id uuid references public.employees_meta (id) on delete set null;
alter table public.order_items add column if not exists staff_price numeric(10, 2);
create index if not exists orders_staff_idx on public.orders (staff_employee_id, created_at desc) where staff_employee_id is not null;
grant select (staff_employee_id) on public.orders to authenticated;
grant select (staff_price) on public.order_items to authenticated;

-- an order for an employee carries no money; the employee's name is shown on it
create or replace function public.orders_staff_meal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if tg_op = 'UPDATE' and new.staff_employee_id is distinct from old.staff_employee_id then
    raise exception 'STAFF_MEAL_LOCKED' using errcode = '42501';
  end if;
  if new.staff_employee_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select full_name into v_name from public.employees_meta where id = new.staff_employee_id and is_active;
    if v_name is null then
      raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
    end if;
    new.customer_name := left(v_name, 120);
    new.customer_phone := '';
    new.customer_address := '';
  end if;
  new.subtotal := 0;
  new.discount_type := null;
  new.discount_value := 0;
  new.discount_amount := 0;
  new.total := 0;
  new.vat_amount := 0;
  return new;
end;
$$;
drop trigger if exists orders_staff_meal on public.orders;
create trigger orders_staff_meal before insert or update on public.orders
  for each row execute function public.orders_staff_meal();

-- lines of a staff meal: price moves to staff_price, sale value is zero
create or replace function public.order_items_staff_meal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.orders where id = new.order_id and staff_employee_id is not null) then
    return new;
  end if;
  if new.unit_price_snapshot <> 0 then
    new.staff_price := new.unit_price_snapshot;
  end if;
  new.unit_price_snapshot := 0;
  new.line_total := 0;
  return new;
end;
$$;
drop trigger if exists order_items_staff_meal on public.order_items;
create trigger order_items_staff_meal before insert or update on public.order_items
  for each row execute function public.order_items_staff_meal();

-- nothing is ever paid for a staff meal (keeps the cash drawer exact)
create or replace function public.payments_no_staff_meal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.orders where id = new.order_id and staff_employee_id is not null) then
    raise exception 'STAFF_MEAL_NOT_PAID' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists payments_no_staff_meal on public.payments;
create trigger payments_no_staff_meal before insert on public.payments
  for each row execute function public.payments_no_staff_meal();

-- place_order passes the chosen employee through
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.place_order(jsonb)'::regprocedure);
  if position('staff_employee_id' in def) > 0 then
    return;
  end if;
  patched := replace(def,
    'cashier_id, shift_id, notes, created_at
  ) values (',
    'cashier_id, shift_id, notes, created_at, staff_employee_id
  ) values (');
  patched := replace(patched,
    'round(v_cost, 2), v_uid, v_shift, left(coalesce(payload ->> ''notes'', ''''), 500), v_created
  ) returning * into v_order;',
    'round(v_cost, 2), v_uid, v_shift, left(coalesce(payload ->> ''notes'', ''''), 500), v_created,
    nullif(payload ->> ''staff_employee_id'', '''')::uuid
  ) returning * into v_order;');
  -- a staff meal is sent without payments
  patched := replace(patched,
    'if coalesce((payload ->> ''pay_later'')::boolean, false) then',
    'if nullif(payload ->> ''staff_employee_id'', '''') is not null then
    if v_pay_sum > 0 then
      raise exception ''STAFF_MEAL_NOT_PAID'' using errcode = ''22023'';
    end if;
  elsif coalesce((payload ->> ''pay_later'')::boolean, false) then');
  if patched = def or position('nullif(payload ->> ''staff_employee_id''' in patched) = 0
     or position('STAFF_MEAL_NOT_PAID' in patched) = 0 then
    raise exception 'place_order patch failed';
  end if;
  execute patched;
end;
$$;

-- report: what each employee ate in a period (menu value; cost only for those who may see costs)
create or replace function public.report_staff_meals(p_from date, p_to date)
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
  perform public.require_perm('employees');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'employees', coalesce((select jsonb_agg(x order by x.value desc) from (
      select e.id, e.full_name as name, count(distinct o.id) as meals,
        coalesce(sum(oi.quantity), 0) as items,
        coalesce(sum(oi.staff_price * oi.quantity), 0) as value,
        case when v_costs then coalesce(sum(oi.unit_cost_snapshot * oi.quantity), 0) end as cost
      from public.orders o
      join public.employees_meta e on e.id = o.staff_employee_id
      join public.order_items oi on oi.order_id = o.id and oi.voided_at is null
      where o.created_at >= v_s and o.created_at < v_e and o.status not in ('cancelled', 'refunded')
      group by e.id, e.full_name
    ) x), '[]'::jsonb),
    'meals', coalesce((select jsonb_agg(m order by m.created_at desc) from (
      select o.id, o.order_number, o.created_at, e.full_name as employee,
        (select full_name from public.profiles where id = o.cashier_id) as by,
        (select string_agg(oi.quantity || '× ' || oi.name_snapshot, '، ' order by oi.created_at)
           from public.order_items oi where oi.order_id = o.id and oi.voided_at is null) as items,
        (select coalesce(sum(oi.staff_price * oi.quantity), 0) from public.order_items oi where oi.order_id = o.id and oi.voided_at is null) as value
      from public.orders o
      join public.employees_meta e on e.id = o.staff_employee_id
      where o.created_at >= v_s and o.created_at < v_e and o.status not in ('cancelled', 'refunded')
      order by o.created_at desc
      limit 500
    ) m), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.report_staff_meals(date, date) from public, anon;
grant execute on function public.report_staff_meals(date, date) to authenticated;

-- staff meals are not sales: leave them out of order counts, average ticket, best sellers, shift counts.
-- (Profit keeps their cost: the food was really used.)
do $$
declare
  fn text;
  def text;
  patched text;
begin
  foreach fn in array array[
    'public.report_sales(date,date)', 'public.report_orders(date,date)', 'public.report_hourly(date,date)',
    'public.report_cashiers(date,date)', 'public.report_payments(date,date)', 'public.report_tax(date,date)',
    'public.report_top_items(date,date,integer)', 'public.shift_report(uuid)', 'public.dashboard_extra()'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if position('staff_employee_id is null' in def) > 0 then
      continue;
    end if;
    patched := replace(def, 'status not in (''cancelled'', ''refunded'')', 'status not in (''cancelled'', ''refunded'') and staff_employee_id is null');
    if fn = 'public.report_cashiers(date,date)' then
      patched := replace(patched, 'where o.created_at >= public.range_start(p_from) and o.created_at < public.range_end(p_to)',
                                  'where o.created_at >= public.range_start(p_from) and o.created_at < public.range_end(p_to) and o.staff_employee_id is null');
    end if;
    if fn = 'public.report_orders(date,date)' then
      patched := replace(patched, 'from public.orders where created_at >= v_s and created_at < v_e group by status',
                                  'from public.orders where created_at >= v_s and created_at < v_e and staff_employee_id is null group by status');
    end if;
    if patched = def then
      raise exception 'staff meal patch found nothing in %', fn;
    end if;
    execute patched;
  end loop;

  def := pg_get_functiondef('public.dashboard_today()'::regprocedure);
  if position('staff_employee_id is null' in def) = 0 then
    patched := replace(def, 'coalesce((select count(*) from public.orders o where o.status not in (''cancelled'', ''refunded'')',
                            'coalesce((select count(*) from public.orders o where o.status not in (''cancelled'', ''refunded'') and o.staff_employee_id is null');
    if patched = def then
      raise exception 'staff meal patch found nothing in dashboard_today';
    end if;
    execute patched;
  end if;
end;
$$;

notify pgrst, 'reload schema';
