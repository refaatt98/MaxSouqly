-- =====================================================================
-- Reports (aggregated in SQL) and Realtime publication
-- All date parameters are local restaurant dates (inclusive).
-- =====================================================================

create or replace function public.restaurant_tz()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from public.restaurant_settings limit 1), 'Asia/Jerusalem')
$$;

create or replace function public.local_date(p_ts timestamptz)
returns date
language sql
stable
as $$
  select (p_ts at time zone public.restaurant_tz())::date
$$;

-- start (inclusive) / end (exclusive) timestamps for a local date range
create or replace function public.range_start(p_from date)
returns timestamptz
language sql
stable
as $$
  select (p_from::timestamp at time zone public.restaurant_tz())
$$;
create or replace function public.range_end(p_to date)
returns timestamptz
language sql
stable
as $$
  select ((p_to + 1)::timestamp at time zone public.restaurant_tz())
$$;

create or replace function public.check_range(p_from date, p_to date)
returns void
language plpgsql
immutable
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.dashboard_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public.local_date(now());
  v_week_start date;
  v_settings public.restaurant_settings;
  v_res jsonb;
begin
  perform public.require_role('owner', 'manager');
  select * into v_settings from public.restaurant_settings limit 1;
  -- week starts on Saturday (dow: 0=Sun ... 6=Sat)
  v_week_start := v_today - ((extract(dow from v_today)::integer + 1) % 7);

  with day_stats as (
    select d::date as day,
      coalesce((select sum(total) from public.orders o where o.status not in ('cancelled', 'refunded')
        and o.created_at >= public.range_start(d::date) and o.created_at < public.range_end(d::date)), 0) as sales,
      coalesce((select count(*) from public.orders o where o.status not in ('cancelled', 'refunded')
        and o.created_at >= public.range_start(d::date) and o.created_at < public.range_end(d::date)), 0) as orders,
      coalesce((select sum(cost_total) from public.orders o where o.status not in ('cancelled', 'refunded')
        and o.created_at >= public.range_start(d::date) and o.created_at < public.range_end(d::date)), 0) as cogs,
      coalesce((select sum(amount) from public.expenses e where e.expense_date = d::date), 0) as expenses
    from generate_series(least(v_today - 1, v_week_start), v_week_start + 6, interval '1 day') d
  )
  select jsonb_build_object(
    'today', (select jsonb_build_object('sales', sales, 'orders', orders, 'profit', sales - cogs - expenses) from day_stats where day = v_today),
    'yesterday', (select jsonb_build_object('sales', sales, 'orders', orders, 'profit', sales - cogs - expenses) from day_stats where day = v_today - 1),
    'week', (select jsonb_agg(jsonb_build_object('date', day, 'sales', case when day > v_today then null else sales end, 'orders', orders) order by day)
             from day_stats where day >= v_week_start),
    'active_orders', (select count(*) from public.orders where status in ('new', 'preparing', 'ready')),
    'active_dine_in_tables', (select count(distinct table_no) from public.orders where status in ('new', 'preparing', 'ready') and type = 'dine_in'),
    'table_count', v_settings.table_count,
    'low_stock_count', (select count(*) from public.ingredients where is_active and quantity <= min_quantity),
    'unread_notifications', (select count(*) from public.notifications where public.current_user_role() = any(target_roles) and not (auth.uid() = any(read_by))),
    'open_purchase_orders', (select count(*) from public.purchase_orders where status in ('draft', 'sent'))
  ) into v_res;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------
create or replace function public.report_sales(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
  v_len integer := p_to - p_from + 1;
  v_res jsonb;
begin
  perform public.require_role('owner', 'manager');
  perform public.check_range(p_from, p_to);
  with o as (
    select * from public.orders where created_at >= v_s and created_at < v_e and status not in ('cancelled', 'refunded')
  )
  select jsonb_build_object(
    'total', coalesce((select sum(total) from o), 0),
    'orders', (select count(*) from o),
    'avg_ticket', coalesce((select round(avg(total), 2) from o), 0),
    'discounts', coalesce((select sum(discount_amount) from o), 0),
    'vat', coalesce((select sum(vat_amount) from o), 0),
    'voided', (select count(*) from public.orders where created_at >= v_s and created_at < v_e and status in ('cancelled', 'refunded')),
    'prev_total', coalesce((select sum(total) from public.orders
       where created_at >= public.range_start(p_from - v_len) and created_at < v_s and status not in ('cancelled', 'refunded')), 0),
    'by_day', (select jsonb_agg(jsonb_build_object('date', d::date,
        'total', coalesce((select sum(total) from o where public.local_date(o.created_at) = d::date), 0),
        'orders', (select count(*) from o where public.local_date(o.created_at) = d::date)) order by d)
      from generate_series(p_from, p_to, interval '1 day') d),
    'by_payment', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'count', c))
      from (select p.method, sum(p.amount) amt, count(*) c from public.payments p join o on o.id = p.order_id group by p.method) x), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'total', t, 'orders', c))
      from (select type, sum(total) t, count(*) c from o group by type) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------
-- Profit = sales − cost of goods (recipe snapshot cost) − expenses
-- ---------------------------------------------------------------------
create or replace function public.report_profit(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s timestamptz := public.range_start(p_from);
  v_e timestamptz := public.range_end(p_to);
  v_len integer := p_to - p_from + 1;
  v_res jsonb;
begin
  perform public.require_role('owner', 'manager');
  perform public.check_range(p_from, p_to);
  with o as (
    select * from public.orders where created_at >= v_s and created_at < v_e and status not in ('cancelled', 'refunded')
  ), days as (
    select d::date as day,
      coalesce((select sum(total) from o where public.local_date(o.created_at) = d::date), 0) as revenue,
      coalesce((select sum(cost_total) from o where public.local_date(o.created_at) = d::date), 0) as cogs,
      coalesce((select sum(amount) from public.expenses e where e.expense_date = d::date), 0) as expenses
    from generate_series(p_from, p_to, interval '1 day') d
  )
  select jsonb_build_object(
    'revenue', (select sum(revenue) from days),
    'cogs', (select sum(cogs) from days),
    'expenses', (select sum(expenses) from days),
    'gross', (select sum(revenue - cogs) from days),
    'net', (select sum(revenue - cogs - expenses) from days),
    'prev_net', (
      coalesce((select sum(total - cost_total) from public.orders where created_at >= public.range_start(p_from - v_len) and created_at < v_s
        and status not in ('cancelled', 'refunded')), 0)
      - coalesce((select sum(amount) from public.expenses where expense_date >= p_from - v_len and expense_date < p_from), 0)),
    'by_day', (select jsonb_agg(jsonb_build_object('date', day, 'revenue', revenue, 'cogs', cogs, 'expenses', expenses,
                'net', revenue - cogs - expenses) order by day) from days),
    'expenses_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amt) order by amt desc)
      from (select category, sum(amount) amt from public.expenses where expense_date between p_from and p_to group by category) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;

create or replace function public.report_top_items(p_from date, p_to date, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager');
  perform public.check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(x order by x.qty desc)
    from (
      select oi.menu_item_id, max(oi.name_snapshot) as name, max(oi.name_he_snapshot) as name_he,
        sum(oi.quantity)::integer as qty, sum(oi.line_total) as revenue,
        sum(oi.unit_cost_snapshot * oi.quantity) as cost,
        (select image_url from public.menu_items m where m.id = oi.menu_item_id) as image_url
      from public.order_items oi join public.orders o on o.id = oi.order_id
      where o.created_at >= public.range_start(p_from) and o.created_at < public.range_end(p_to)
        and o.status not in ('cancelled', 'refunded')
      group by oi.menu_item_id
      order by sum(oi.quantity) desc
      limit greatest(1, least(coalesce(p_limit, 10), 100))
    ) x
  ), '[]'::jsonb);
end;
$$;

-- dow: 0 = Sunday … 6 = Saturday (the client orders the grid Saturday-first)
create or replace function public.report_hourly(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager');
  perform public.check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'orders', c, 'total', t))
    from (
      select extract(dow from created_at at time zone public.restaurant_tz())::integer as dow,
        extract(hour from created_at at time zone public.restaurant_tz())::integer as hr,
        count(*) c, sum(total) t
      from public.orders
      where created_at >= public.range_start(p_from) and created_at < public.range_end(p_to)
        and status not in ('cancelled', 'refunded')
      group by 1, 2
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.report_cashiers(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager');
  perform public.check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(x order by x.total desc)
    from (
      select o.cashier_id, p.full_name as name, p.avatar_url,
        count(*) filter (where o.status not in ('cancelled', 'refunded')) as orders,
        coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'refunded')), 0) as total,
        coalesce(round(avg(o.total) filter (where o.status not in ('cancelled', 'refunded')), 2), 0) as avg_ticket,
        coalesce(sum(o.discount_amount) filter (where o.status not in ('cancelled', 'refunded')), 0) as discounts,
        count(*) filter (where o.status in ('cancelled', 'refunded')) as voids
      from public.orders o left join public.profiles p on p.id = o.cashier_id
      where o.created_at >= public.range_start(p_from) and o.created_at < public.range_end(p_to)
      group by o.cashier_id, p.full_name, p.avatar_url
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.report_inventory(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager', 'inventory');
  perform public.check_range(p_from, p_to);
  return jsonb_build_object(
    'stock_value', (select coalesce(round(sum(greatest(quantity, 0) * cost_per_unit), 2), 0) from public.ingredients where is_active),
    'items_count', (select count(*) from public.ingredients where is_active),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name_ar, 'name_he', name_he, 'unit', unit,
        'quantity', quantity, 'min_quantity', min_quantity) order by quantity / nullif(min_quantity, 0))
      from public.ingredients where is_active and quantity <= min_quantity), '[]'::jsonb),
    'by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'count', c, 'value', v))
      from (select m.reason, count(*) c, round(sum(abs(m.change) * i.cost_per_unit), 2) v
            from public.stock_movements m join public.ingredients i on i.id = m.ingredient_id
            where m.created_at >= public.range_start(p_from) and m.created_at < public.range_end(p_to)
            group by m.reason) x), '[]'::jsonb),
    'top_consumed', coalesce((select jsonb_agg(x order by x.value desc)
      from (select i.id, i.name_ar as name, i.name_he, i.unit, round(sum(-m.change), 3) as quantity,
              round(sum(-m.change * i.cost_per_unit), 2) as value
            from public.stock_movements m join public.ingredients i on i.id = m.ingredient_id
            where m.reason = 'sale' and m.created_at >= public.range_start(p_from) and m.created_at < public.range_end(p_to)
            group by i.id, i.name_ar, i.name_he, i.unit
            order by value desc limit 10) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_employees(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager');
  perform public.check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(x order by x.hours desc)
    from (
      select e.id, e.full_name as name, e.position, e.avatar_url, e.salary_type, e.salary_amount,
        coalesce(round(sum(extract(epoch from (coalesce(a.clock_out, now()) - a.clock_in)) / 3600)::numeric, 2), 0) as hours,
        count(distinct public.local_date(a.clock_in)) as days,
        (select count(*) from public.work_shifts w where w.employee_id = e.id and w.shift_date between p_from and p_to) as scheduled_shifts
      from public.employees_meta e
      left join public.attendance a on a.employee_id = e.id
        and a.clock_in >= public.range_start(p_from) and a.clock_in < public.range_end(p_to)
      where e.is_active
      group by e.id
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.dashboard_today(), public.report_sales(date, date), public.report_profit(date, date),
  public.report_top_items(date, date, integer), public.report_hourly(date, date), public.report_cashiers(date, date),
  public.report_inventory(date, date), public.report_employees(date, date),
  public.restaurant_tz(), public.local_date(timestamptz), public.range_start(date), public.range_end(date),
  public.check_range(date, date)
to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.orders, public.order_items, public.notifications, public.ingredients, public.restaurant_settings, public.menu_items;
  end if;
end;
$$;
alter table public.orders replica identity full;
alter table public.order_items replica identity full;
