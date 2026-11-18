-- MAX: run once in Supabase → SQL Editor (staff meals + meat types/extras). Safe to run again.
begin;
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

-- =====================================================================
-- Meat types (variants) and extras with quantities.
--  * An item can have "variants" (choose exactly one, e.g. chicken / beef / mix).
--    A variant's price is the FULL price of the item with it.
--  * "Extras" can be added several times each (×1, ×2 … up to max_qty).
--  * Variants and extras can have their own ingredients: stock is deducted and
--    their cost is added to the line's cost.
-- order_items.options keeps what was chosen: [{id, name, name_he, price, qty, kind}]
-- (a variant is stored with price 0 because its price is already the line's unit price).
-- =====================================================================

alter table public.menu_item_options add column if not exists kind text not null default 'extra';
alter table public.menu_item_options add column if not exists max_qty integer not null default 5;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_item_options_kind_check') then
    alter table public.menu_item_options add constraint menu_item_options_kind_check check (kind in ('extra', 'variant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_item_options_max_qty_check') then
    alter table public.menu_item_options add constraint menu_item_options_max_qty_check check (max_qty between 1 and 20);
  end if;
end;
$$;
grant select (kind, max_qty) on public.menu_item_options to authenticated;

-- ingredients used by a variant or an extra (per one unit of it)
create table if not exists public.menu_option_recipes (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.menu_item_options (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  quantity numeric(12, 4) not null check (quantity > 0),
  unit public.unit_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (option_id, ingredient_id)
);
create index if not exists menu_option_recipes_option_idx on public.menu_option_recipes (option_id);
alter table public.menu_option_recipes enable row level security;
drop trigger if exists menu_option_recipes_updated_at on public.menu_option_recipes;
create trigger menu_option_recipes_updated_at before update on public.menu_option_recipes for each row execute function public.set_updated_at();
drop trigger if exists menu_option_recipes_unit_check on public.menu_option_recipes;
create trigger menu_option_recipes_unit_check before insert or update on public.menu_option_recipes for each row execute function public.check_recipe_unit();
drop policy if exists menu_option_recipes_select on public.menu_option_recipes;
create policy menu_option_recipes_select on public.menu_option_recipes for select to authenticated
  using (public.has_perm('menu') or public.has_perm('inventory'));
drop policy if exists menu_option_recipes_write on public.menu_option_recipes;
create policy menu_option_recipes_write on public.menu_option_recipes for all to authenticated
  using (public.has_perm('menu')) with check (public.has_perm('menu'));
grant select, insert, update, delete on public.menu_option_recipes to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'menu_option_recipes') then
    alter publication supabase_realtime add table public.menu_option_recipes;
  end if;
end;
$$;

-- cost of one unit of a variant / extra
create or replace function public.option_cost(p_option_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(r.quantity * public.unit_factor(r.unit, i.unit) * i.cost_per_unit), 2), 0)
  from public.menu_option_recipes r
  join public.ingredients i on i.id = r.ingredient_id
  where r.option_id = p_option_id
$$;
revoke execute on function public.option_cost(uuid) from public, anon, authenticated;

-- move the stock of the chosen variant / extras of `p_units` dishes (negative = out, positive = back)
create or replace function public.move_options_stock(p_options jsonb, p_units numeric, p_reason public.stock_reason, p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  for v_r in
    select r.ingredient_id, sum(r.quantity * public.unit_factor(r.unit, i.unit) * coalesce((e ->> 'qty')::numeric, 1)) as per_unit
    from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) e
    join public.menu_option_recipes r on r.option_id = (e ->> 'id')::uuid
    join public.ingredients i on i.id = r.ingredient_id
    where jsonb_typeof(e) = 'object' and e ? 'id'
    group by r.ingredient_id
  loop
    perform public.apply_stock_change(v_r.ingredient_id, v_r.per_unit * p_units, p_reason, p_order_id, p_note);
  end loop;
end;
$$;
revoke execute on function public.move_options_stock(jsonb, numeric, public.stock_reason, uuid, text) from public, anon, authenticated;

-- meat types / extras that cannot be served right now (an ingredient has run out) — for the cashier screen
create or replace function public.options_out_of_stock()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(distinct mr.option_id), '[]'::jsonb)
  from public.menu_option_recipes mr
  join public.ingredients i on i.id = mr.ingredient_id
  where i.quantity < mr.quantity * public.unit_factor(mr.unit, i.unit)
    and public.current_user_role() is not null
$$;
revoke execute on function public.options_out_of_stock() from public, anon;
grant execute on function public.options_out_of_stock() to authenticated;

-- place_order: variant (full price) + extras with quantities, their cost and their stock
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.place_order(jsonb)'::regprocedure);
  if position('VARIANT_REQUIRED' in def) > 0 then
    return;
  end if;

  patched := replace(def, '  v_opts_price numeric;', '  v_opts_price numeric;
  v_opts_cost numeric;
  v_req jsonb;
  v_n integer;
  v_var public.menu_item_options;
  v_out text;');

  patched := replace(patched,
'    select coalesce(jsonb_agg(jsonb_build_object(''id'', o.id, ''name'', o.name_ar, ''name_he'', o.name_he, ''price'', o.price) order by o.sort_order, o.name_ar), ''[]''::jsonb),
           coalesce(sum(o.price), 0)
      into v_opts, v_opts_price
    from public.menu_item_options o
    where o.menu_item_id = v_menu.id and o.is_active
      and o.id in (select (jsonb_array_elements_text(coalesce(v_item -> ''options'', ''[]''::jsonb)))::uuid);
    if jsonb_array_length(v_opts) <> jsonb_array_length(coalesce(v_item -> ''options'', ''[]''::jsonb)) then
      raise exception ''INVALID_OPTIONS'' using errcode = ''22023'';
    end if;
    v_menu.price := v_menu.price + v_opts_price;',
'    -- extras: ids (one each) or {id, qty}; the same id twice adds up
    select coalesce(jsonb_agg(jsonb_build_object(''id'', x.id, ''qty'', x.qty)), ''[]''::jsonb) into v_req
    from (
      select (case when jsonb_typeof(e) = ''string'' then e #>> ''{}'' else e ->> ''id'' end)::uuid as id,
             sum(case when jsonb_typeof(e) = ''object'' and e ? ''qty'' then (e ->> ''qty'')::integer else 1 end) as qty
      from jsonb_array_elements(coalesce(v_item -> ''options'', ''[]''::jsonb)) e
      group by 1
    ) x;
    select coalesce(jsonb_agg(jsonb_build_object(''id'', o.id, ''name'', o.name_ar, ''name_he'', o.name_he, ''price'', o.price,
                                                 ''qty'', r.qty, ''kind'', ''extra'') order by o.sort_order, o.name_ar), ''[]''::jsonb),
           coalesce(sum(o.price * r.qty), 0), coalesce(sum(public.option_cost(o.id) * r.qty), 0), count(*)
      into v_opts, v_opts_price, v_opts_cost, v_n
    from jsonb_to_recordset(v_req) r(id uuid, qty integer)
    join public.menu_item_options o on o.id = r.id
    where o.menu_item_id = v_menu.id and o.is_active and o.kind = ''extra'' and r.qty between 1 and o.max_qty;
    if v_n <> jsonb_array_length(v_req) then
      raise exception ''INVALID_OPTIONS'' using errcode = ''22023'';
    end if;
    -- an extra whose ingredients ran out cannot be sold
    select o.name_ar into v_out
    from jsonb_to_recordset(v_req) r(id uuid, qty integer)
    join public.menu_item_options o on o.id = r.id
    join public.menu_option_recipes mr on mr.option_id = r.id
    join public.ingredients i on i.id = mr.ingredient_id
    where i.quantity < mr.quantity * public.unit_factor(mr.unit, i.unit) * r.qty * v_qty
    limit 1;
    if v_out is not null then
      raise exception ''OPTION_OUT:%'', v_out using errcode = ''22023'';
    end if;

    -- variant (meat type): required when the item has any; its price is the full price of the dish
    if exists (select 1 from public.menu_item_options where menu_item_id = v_menu.id and is_active and kind = ''variant'') then
      select * into v_var from public.menu_item_options
      where id = nullif(v_item ->> ''variant_id'', '''')::uuid and menu_item_id = v_menu.id and is_active and kind = ''variant'';
      if not found then
        raise exception ''VARIANT_REQUIRED:%'', v_menu.name_ar using errcode = ''22023'';
      end if;
      if exists (select 1 from public.menu_option_recipes mr join public.ingredients i on i.id = mr.ingredient_id
                 where mr.option_id = v_var.id and i.quantity < mr.quantity * public.unit_factor(mr.unit, i.unit) * v_qty) then
        raise exception ''OPTION_OUT:%'', v_var.name_ar using errcode = ''22023'';
      end if;
      v_menu.price := v_var.price;
      v_unit_cost := v_unit_cost + public.option_cost(v_var.id);
      v_opts := jsonb_build_array(jsonb_build_object(''id'', v_var.id, ''name'', v_var.name_ar, ''name_he'', v_var.name_he,
                                                     ''price'', 0, ''qty'', 1, ''kind'', ''variant'')) || v_opts;
    end if;
    v_unit_cost := v_unit_cost + v_opts_cost;
    v_menu.price := v_menu.price + v_opts_price;');

  patched := replace(patched,
'    select ri.ingredient_id, sum(ri.quantity * public.unit_factor(ri.unit, i.unit) * oi.quantity) as qty
    from public.order_items oi
    join public.recipe_items ri on ri.menu_item_id = oi.menu_item_id
    join public.ingredients i on i.id = ri.ingredient_id
    where oi.order_id = v_order.id
    group by ri.ingredient_id',
'    select s.ingredient_id, sum(s.qty) as qty from (
      select ri.ingredient_id, ri.quantity * public.unit_factor(ri.unit, i.unit) * oi.quantity as qty
      from public.order_items oi
      join public.recipe_items ri on ri.menu_item_id = oi.menu_item_id
      join public.ingredients i on i.id = ri.ingredient_id
      where oi.order_id = v_order.id
      union all
      select r.ingredient_id, r.quantity * public.unit_factor(r.unit, i.unit) * oi.quantity * coalesce((e ->> ''qty'')::numeric, 1)
      from public.order_items oi
      cross join lateral jsonb_array_elements(oi.options) e
      join public.menu_option_recipes r on r.option_id = (e ->> ''id'')::uuid
      join public.ingredients i on i.id = r.ingredient_id
      where oi.order_id = v_order.id
    ) s
    group by s.ingredient_id');

  if position('VARIANT_REQUIRED' in patched) = 0 or position('menu_option_recipes' in patched) = 0 or position('v_opts_cost numeric' in patched) = 0 then
    raise exception 'place_order variants patch failed';
  end if;
  execute patched;
end;
$$;

-- cancelling / replacing one line gives back its variant and extras too
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.void_order_item(uuid,integer,text)'::regprocedure);
  if position('move_options_stock' in def) = 0 then
    patched := replace(def,
      'perform public.move_item_stock(v_item.menu_item_id, v_qty, ''void'', v_order.id, ''إلغاء صنف #'' || v_order.order_number);',
      'perform public.move_item_stock(v_item.menu_item_id, v_qty, ''void'', v_order.id, ''إلغاء صنف #'' || v_order.order_number);
    perform public.move_options_stock(v_item.options, v_qty, ''void'', v_order.id, ''إلغاء صنف #'' || v_order.order_number);');
    if patched = def then
      raise exception 'void_order_item patch failed';
    end if;
    execute patched;
  end if;

  def := pg_get_functiondef('public.replace_order_item(uuid,uuid,integer,text,text)'::regprocedure);
  if position('move_options_stock' in def) = 0 then
    patched := replace(def,
      'perform public.move_item_stock(v_item.menu_item_id, v_item.quantity, ''void'', v_order.id, ''استبدال صنف #'' || v_order.order_number);',
      'perform public.move_item_stock(v_item.menu_item_id, v_item.quantity, ''void'', v_order.id, ''استبدال صنف #'' || v_order.order_number);
    perform public.move_options_stock(v_item.options, v_item.quantity, ''void'', v_order.id, ''استبدال صنف #'' || v_order.order_number);');
    if patched = def then
      raise exception 'replace_order_item patch failed';
    end if;
    execute patched;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- check: every row must say true
select 'staff meals' as step, position('staff_employee_id' in pg_get_functiondef('public.place_order(jsonb)'::regprocedure)) > 0 as ok
union all select 'meat types', position('VARIANT_REQUIRED' in pg_get_functiondef('public.place_order(jsonb)'::regprocedure)) > 0
union all select 'sold out check', position('OPTION_OUT' in pg_get_functiondef('public.place_order(jsonb)'::regprocedure)) > 0
union all select 'void returns extras', position('move_options_stock' in pg_get_functiondef('public.void_order_item(uuid,integer,text)'::regprocedure)) > 0
union all select 'staff meals report', exists (select 1 from pg_proc where proname = 'report_staff_meals');
