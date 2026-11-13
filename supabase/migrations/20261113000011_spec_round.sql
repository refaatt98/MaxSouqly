-- =====================================================================
-- Spec round: owner-granted permissions, hidden purchase costs, customers,
-- item extras, send-now/pay-later orders, salary advances, daily wages,
-- payroll cycle day, attendance kiosk, cashier stocktake, printers.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissions the owner grants (permanently or until a date)
-- ---------------------------------------------------------------------
create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null check (permission in ('reports', 'employees', 'customers', 'costs', 'activity', 'stocktake_approve')),
  expires_at timestamptz,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);
alter table public.user_permissions enable row level security;

-- owner: everything; anyone else: an unexpired grant
create or replace function public.has_perm(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('owner')
    or (public.current_user_role() is not null and exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.permission = p and (up.expires_at is null or up.expires_at > now())))
$$;

create or replace function public.require_perm(p text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_perm(p) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

-- my permissions (for the UI)
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case when public.has_role('owner')
    then array['reports', 'employees', 'customers', 'costs', 'activity', 'stocktake_approve']
    else coalesce((select array_agg(permission) from public.user_permissions
                   where user_id = auth.uid() and (expires_at is null or expires_at > now())), '{}') end
$$;

drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_role('owner'));
drop policy if exists user_permissions_write on public.user_permissions;
create policy user_permissions_write on public.user_permissions for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- report / payroll gates: role checks become permission checks
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'dashboard_today', 'report_sales', 'report_profit', 'report_top_items', 'report_hourly', 'report_cashiers',
      'report_employees', 'compute_payroll')
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, $r$public.require_role('owner', 'manager')$r$,
      case when f.proname in ('report_employees', 'compute_payroll') then $r$public.require_perm('employees')$r$
           else $r$public.require_perm('reports')$r$ end);
    execute def;
  end loop;
end;
$$;

-- RLS: staff records, expenses, activity log follow the grants
drop policy if exists employees_select on public.employees_meta;
create policy employees_select on public.employees_meta for select to authenticated
  using (public.has_perm('employees') or profile_id = auth.uid());
drop policy if exists employees_write on public.employees_meta;
create policy employees_write on public.employees_meta for all to authenticated
  using (public.has_perm('employees')) with check (public.has_perm('employees'));
drop policy if exists work_shifts_select on public.work_shifts;
create policy work_shifts_select on public.work_shifts for select to authenticated
  using (public.has_perm('employees')
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));
drop policy if exists work_shifts_write on public.work_shifts;
create policy work_shifts_write on public.work_shifts for all to authenticated
  using (public.has_perm('employees')) with check (public.has_perm('employees'));
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.has_perm('employees')
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));
drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all to authenticated
  using (public.has_perm('employees')) with check (public.has_perm('employees'));
drop policy if exists payroll_select on public.payroll;
create policy payroll_select on public.payroll for select to authenticated
  using (public.has_perm('employees')
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));
drop policy if exists payroll_write on public.payroll;
create policy payroll_write on public.payroll for all to authenticated
  using (public.has_perm('employees')) with check (public.has_perm('employees'));
drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses for all to authenticated
  using (public.has_perm('reports')) with check (public.has_perm('reports'));
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.has_perm('activity'));

-- ---------------------------------------------------------------------
-- 2. Purchase costs: only the owner (or a 'costs' grant) can read them
-- ---------------------------------------------------------------------
create or replace function public.grant_select_except(p_table text, p_hidden text[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and column_name <> all (p_hidden);
  execute format('revoke select on public.%I from authenticated, anon', p_table);
  execute format('grant select (%s) on public.%I to authenticated', v_cols, p_table);
end;
$$;

select public.grant_select_except('ingredients', array['cost_per_unit']);
select public.grant_select_except('menu_items', array['cost_cache']);
select public.grant_select_except('purchase_orders', array['total']);
select public.grant_select_except('purchase_order_items', array['unit_cost', 'cost_before']);
select public.grant_select_except('orders', array['cost_total']);
select public.grant_select_except('order_items', array['unit_cost_snapshot']);

-- non-permitted writers cannot set prices
create or replace function public.guard_cost_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.has_perm('costs') then
    return new;
  end if;
  if tg_table_name = 'ingredients' then
    new.cost_per_unit := case when tg_op = 'UPDATE' then old.cost_per_unit else 0 end;
  elsif tg_table_name = 'purchase_order_items' then
    -- staff lines are priced at the material's current cost; the owner can correct it before receiving
    new.unit_cost := case when tg_op = 'UPDATE' then old.unit_cost
      else coalesce((select cost_per_unit from public.ingredients where id = new.ingredient_id), 0) end;
  end if;
  return new;
end;
$$;
drop trigger if exists ingredients_guard_cost on public.ingredients;
create trigger ingredients_guard_cost before insert or update on public.ingredients
for each row execute function public.guard_cost_columns();
drop trigger if exists poi_guard_cost on public.purchase_order_items;
create trigger poi_guard_cost before insert or update on public.purchase_order_items
for each row execute function public.guard_cost_columns();

-- cost figures for the UI, for those allowed to see them
create or replace function public.cost_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_perm('costs') then
    return null;
  end if;
  return jsonb_build_object(
    'ingredients', coalesce((select jsonb_object_agg(id, cost_per_unit) from public.ingredients), '{}'::jsonb),
    'menu_items', coalesce((select jsonb_object_agg(id, cost_cache) from public.menu_items), '{}'::jsonb),
    'purchase_orders', coalesce((select jsonb_object_agg(id, total) from public.purchase_orders), '{}'::jsonb)
  );
end;
$$;

create or replace function public.po_item_costs(p_po_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_perm('costs') then
    return null;
  end if;
  return coalesce((select jsonb_object_agg(id, unit_cost) from public.purchase_order_items where purchase_order_id = p_po_id), '{}'::jsonb);
end;
$$;

-- orders returned by functions drop cost figures unless allowed
create or replace function public.order_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (to_jsonb(o) - case when public.has_perm('costs') then '' else 'cost_total' end)
    || jsonb_build_object(
      'cashier_name', (select full_name from public.profiles where id = o.cashier_id),
      'items', coalesce((select jsonb_agg(to_jsonb(oi) - case when public.has_perm('costs') then '' else 'unit_cost_snapshot' end
                                          order by oi.created_at, oi.name_snapshot)
                         from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p where p.order_id = o.id), '[]'::jsonb)
    )
  from public.orders o
  where o.id = p_order_id
$$;
revoke all on function public.order_json(uuid) from public, anon, authenticated;

-- inventory report: stock values only for cost viewers
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'report_inventory_full') then
    alter function public.report_inventory(date, date) rename to report_inventory_full;
  end if;
end;
$$;
create or replace function public.report_inventory(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb := public.report_inventory_full(p_from, p_to);
begin
  if public.has_perm('costs') then
    return v;
  end if;
  return (v - 'stock_value')
    || jsonb_build_object('by_reason', coalesce((select jsonb_agg(e - 'value') from jsonb_array_elements(v -> 'by_reason') e), '[]'::jsonb))
    || jsonb_build_object('top_consumed', coalesce((select jsonb_agg(e - 'value') from jsonb_array_elements(v -> 'top_consumed') e), '[]'::jsonb));
end;
$$;
revoke execute on function public.report_inventory_full(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Cashier can count stock; approving the count needs a grant
-- ---------------------------------------------------------------------
drop policy if exists ingredients_select on public.ingredients;
create policy ingredients_select on public.ingredients for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory', 'cashier'));
drop policy if exists stock_counts_select on public.stock_counts;
create policy stock_counts_select on public.stock_counts for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory', 'cashier'));
drop policy if exists stock_counts_insert on public.stock_counts;
create policy stock_counts_insert on public.stock_counts for insert to authenticated
  with check (public.has_role('owner', 'manager', 'inventory', 'cashier') and status = 'draft');
drop policy if exists stock_counts_update on public.stock_counts;
create policy stock_counts_update on public.stock_counts for update to authenticated
  using (public.has_role('owner', 'manager', 'inventory', 'cashier') and status = 'draft')
  with check (status = 'draft');
drop policy if exists stock_count_items_select on public.stock_count_items;
create policy stock_count_items_select on public.stock_count_items for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory', 'cashier'));
drop policy if exists stock_count_items_write on public.stock_count_items;
create policy stock_count_items_write on public.stock_count_items for all to authenticated
  using (public.has_role('owner', 'manager', 'inventory', 'cashier')
    and exists (select 1 from public.stock_counts c where c.id = stock_count_id and c.status = 'draft'))
  with check (public.has_role('owner', 'manager', 'inventory', 'cashier')
    and exists (select 1 from public.stock_counts c where c.id = stock_count_id and c.status = 'draft'));

do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.create_stock_count(text)'::regprocedure);
  def := replace(def, $r$public.require_role('owner', 'manager', 'inventory')$r$, $r$public.require_role('owner', 'manager', 'inventory', 'cashier')$r$);
  execute def;
  if not exists (select 1 from pg_proc where proname = 'apply_stock_count_impl') then
    alter function public.apply_stock_count(uuid) rename to apply_stock_count_impl;
  end if;
end;
$$;
create or replace function public.apply_stock_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_perm('stocktake_approve');
  return public.apply_stock_count_impl(p_count_id);
end;
$$;
revoke execute on function public.apply_stock_count_impl(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Customers
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 120),
  phone text not null unique check (phone ~ '^[0-9+]{7,20}$'),
  address text not null default '' check (char_length(address) <= 300),
  notes text not null default '' check (char_length(notes) <= 500),
  orders_count integer not null default 0,
  total_spent numeric(12, 2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customers enable row level security;
drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop policy if exists customers_all on public.customers;
create policy customers_all on public.customers for all to authenticated
  using (public.has_perm('customers')) with check (public.has_perm('customers'));

alter table public.orders add column if not exists customer_id uuid references public.customers (id) on delete set null;
create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
grant select (customer_id) on public.orders to authenticated;

create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g'), '')
$$;

-- keep each customer's totals in step with their orders
create or replace function public.refresh_customer(p_customer uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.customers c set
    orders_count = x.n, total_spent = x.t, last_order_at = x.l
  from (select count(*) n, coalesce(sum(total), 0) t, max(created_at) l
        from public.orders where customer_id = p_customer and status not in ('cancelled', 'refunded')) x
  where c.id = p_customer
$$;

create or replace function public.orders_customer_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_id uuid;
begin
  if tg_op = 'INSERT' and new.customer_id is null then
    v_phone := public.normalize_phone(new.customer_phone);
    if v_phone is not null and v_phone ~ '^[0-9+]{7,20}$' then
      insert into public.customers (phone, name, address)
      values (v_phone, left(trim(new.customer_name), 120), left(trim(new.customer_address), 300))
      on conflict (phone) do update set
        name = case when excluded.name <> '' then excluded.name else public.customers.name end,
        address = case when excluded.address <> '' then excluded.address else public.customers.address end
      returning id into v_id;
      new.customer_id := v_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_customer_link on public.orders;
create trigger orders_customer_link before insert on public.orders for each row execute function public.orders_customer_sync();

create or replace function public.orders_customer_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' and new.customer_id is not null then
    perform public.refresh_customer(new.customer_id);
  end if;
  if tg_op <> 'INSERT' and old.customer_id is not null and (tg_op = 'DELETE' or old.customer_id is distinct from new.customer_id) then
    perform public.refresh_customer(old.customer_id);
  end if;
  return null;
end;
$$;
drop trigger if exists orders_customer_totals on public.orders;
create trigger orders_customer_totals after insert or delete or update of total, status, customer_id on public.orders
for each row execute function public.orders_customer_totals();

-- cashier lookup while taking an order: only what serving needs, never the whole list
create or replace function public.find_customers(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
  digits text := regexp_replace(q, '[^0-9]', '', 'g');
begin
  perform public.require_role('owner', 'manager', 'cashier');
  if char_length(q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x order by x.last_order_at desc nulls last)
    from (
      select c.id, c.name, c.phone, c.address, c.notes, c.orders_count, c.last_order_at,
        coalesce((
          select jsonb_agg(f.name order by f.n desc) from (
            select oi.name_snapshot as name, sum(oi.quantity) n
            from public.orders o join public.order_items oi on oi.order_id = o.id
            where o.customer_id = c.id and oi.voided_at is null and o.status not in ('cancelled', 'refunded')
            group by oi.name_snapshot order by n desc limit 3) f), '[]'::jsonb) as favorites
      from public.customers c
      where (char_length(digits) >= 3 and c.phone like '%' || digits || '%')
         or (char_length(q) >= 2 and c.name ilike '%' || q || '%')
      order by c.last_order_at desc nulls last
      limit 6
    ) x
  ), '[]'::jsonb);
end;
$$;

-- backfill from existing orders
insert into public.customers (phone, name, address)
select distinct on (public.normalize_phone(customer_phone)) public.normalize_phone(customer_phone), left(trim(customer_name), 120), left(trim(customer_address), 300)
from public.orders
where public.normalize_phone(customer_phone) ~ '^[0-9+]{7,20}$'
order by public.normalize_phone(customer_phone), created_at desc
on conflict (phone) do nothing;
update public.orders o set customer_id = c.id
from public.customers c
where o.customer_id is null and c.phone = public.normalize_phone(o.customer_phone);
select public.refresh_customer(id) from public.customers;

-- ---------------------------------------------------------------------
-- 5. Item extras (cheese, sauce…)
-- ---------------------------------------------------------------------
create table if not exists public.menu_item_options (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  name_ar text not null check (char_length(name_ar) between 1 and 80),
  name_he text not null default '' check (char_length(name_he) <= 80),
  price numeric(10, 2) not null default 0 check (price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists menu_item_options_item_idx on public.menu_item_options (menu_item_id, sort_order);
alter table public.menu_item_options enable row level security;
drop trigger if exists menu_item_options_updated_at on public.menu_item_options;
create trigger menu_item_options_updated_at before update on public.menu_item_options for each row execute function public.set_updated_at();
drop policy if exists menu_item_options_select on public.menu_item_options;
create policy menu_item_options_select on public.menu_item_options for select to authenticated
  using (public.current_user_role() is not null);
drop policy if exists menu_item_options_write on public.menu_item_options;
create policy menu_item_options_write on public.menu_item_options for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

alter table public.order_items add column if not exists options jsonb not null default '[]'::jsonb;
grant select (options) on public.order_items to authenticated;

-- ---------------------------------------------------------------------
-- 6. Payment status, pay-later orders, payments counted in the shift that took them
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('paid', 'partial', 'unpaid');
  end if;
end;
$$;
alter table public.orders add column if not exists payment_status public.payment_status not null default 'paid';
alter table public.orders add column if not exists paid_amount numeric(12, 2) not null default 0;
grant select (payment_status, paid_amount) on public.orders to authenticated;
alter table public.payments add column if not exists shift_id uuid references public.cash_shifts (id) on delete set null;
create index if not exists payments_shift_idx on public.payments (shift_id);
update public.payments p set shift_id = o.shift_id from public.orders o where o.id = p.order_id and p.shift_id is null;

create or replace function public.payments_set_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shift_id is null then
    select id into new.shift_id from public.cash_shifts where cashier_id = auth.uid() and closed_at is null;
    if new.shift_id is null then
      select shift_id into new.shift_id from public.orders where id = new.order_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_shift on public.payments;
create trigger payments_shift before insert on public.payments for each row execute function public.payments_set_shift();

create or replace function public.refresh_payment_status(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders o set
    paid_amount = x.paid,
    payment_status = case
      when x.paid >= o.total - 0.009 then 'paid'::public.payment_status
      when x.paid > 0 then 'partial'::public.payment_status
      else 'unpaid'::public.payment_status end
  from (select coalesce(sum(amount), 0) paid from public.payments where order_id = p_order_id) x
  where o.id = p_order_id
    and (o.paid_amount is distinct from x.paid or o.payment_status is distinct from (case
      when x.paid >= o.total - 0.009 then 'paid'::public.payment_status
      when x.paid > 0 then 'partial'::public.payment_status
      else 'unpaid'::public.payment_status end))
$$;

create or replace function public.payments_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_payment_status(coalesce(new.order_id, old.order_id));
  return null;
end;
$$;
drop trigger if exists payments_status on public.payments;
create trigger payments_status after insert or update or delete on public.payments
for each row execute function public.payments_status_trigger();

create or replace function public.orders_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_payment_status(new.id);
  return null;
end;
$$;
drop trigger if exists orders_payment_status on public.orders;
create trigger orders_payment_status after insert or update of total on public.orders
for each row execute function public.orders_status_trigger();

update public.orders o set paid_amount = coalesce((select sum(amount) from public.payments where order_id = o.id), 0);
update public.orders set payment_status = case
  when paid_amount >= total - 0.009 then 'paid'::public.payment_status
  when paid_amount > 0 then 'partial'::public.payment_status
  else 'unpaid'::public.payment_status end;

-- place_order: extras priced from the database; pay_later lets payments be partial or empty
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.place_order(jsonb)'::regprocedure);
  -- extras
  def := replace(def, $r$    v_unit_cost := public.menu_item_cost(v_menu.id);
    v_subtotal := v_subtotal + v_menu.price * v_qty;$r$, $r$    v_unit_cost := public.menu_item_cost(v_menu.id);
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name_ar, 'name_he', o.name_he, 'price', o.price) order by o.sort_order, o.name_ar), '[]'::jsonb),
           coalesce(sum(o.price), 0)
      into v_opts, v_opts_price
    from public.menu_item_options o
    where o.menu_item_id = v_menu.id and o.is_active
      and o.id in (select (jsonb_array_elements_text(coalesce(v_item -> 'options', '[]'::jsonb)))::uuid);
    if jsonb_array_length(v_opts) <> jsonb_array_length(coalesce(v_item -> 'options', '[]'::jsonb)) then
      raise exception 'INVALID_OPTIONS' using errcode = '22023';
    end if;
    v_menu.price := v_menu.price + v_opts_price;
    v_subtotal := v_subtotal + v_menu.price * v_qty;$r$);
  def := replace(def, $r$      'notes', left(coalesce(v_item ->> 'notes', ''), 200)
    );$r$, $r$      'notes', left(coalesce(v_item ->> 'notes', ''), 200), 'options', v_opts
    );$r$);
  def := replace(def, $r$      quantity, line_total, notes, created_at
    ) values ($r$, $r$      quantity, line_total, notes, options, created_at
    ) values ($r$);
  def := replace(def, $r$(v_item ->> 'price')::numeric * (v_item ->> 'qty')::integer, v_item ->> 'notes', v_created$r$,
                      $r$(v_item ->> 'price')::numeric * (v_item ->> 'qty')::integer, v_item ->> 'notes', coalesce(v_item -> 'options', '[]'::jsonb), v_created$r$);
  def := replace(def, $r$  v_lines jsonb := '[]'::jsonb;$r$, $r$  v_lines jsonb := '[]'::jsonb;
  v_opts jsonb;
  v_opts_price numeric;$r$);
  -- pay later
  def := replace(def, $r$  if abs(v_pay_sum - v_total) > 0.01 then$r$,
    $r$  if coalesce((payload ->> 'pay_later')::boolean, false) then
    if v_pay_sum > v_total + 0.01 then
      raise exception 'PAYMENT_MISMATCH' using errcode = '22023';
    end if;
  elsif abs(v_pay_sum - v_total) > 0.01 then$r$);
  if position('v_opts_price' in def) = 0 or position('pay_later' in def) = 0 or position('options, created_at' in def) = 0 then
    raise exception 'place_order patch failed';
  end if;
  execute def;
end;
$$;

-- collect payment for an order that was sent unpaid
create or replace function public.add_payment(p_order_id uuid, p_payments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.require_role('owner', 'manager', 'cashier');
  v_order public.orders;
  v_pay jsonb;
  v_sum numeric := 0;
  v_amount numeric;
  v_tendered numeric;
  v_method public.payment_method;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.status in ('cancelled', 'refunded') then raise exception 'ORDER_CLOSED' using errcode = '22023'; end if;
  if v_role = 'cashier' then
    if not exists (select 1 from public.cash_shifts where cashier_id = auth.uid() and closed_at is null) then
      raise exception 'SHIFT_REQUIRED' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'INVALID_PAYMENTS' using errcode = '22023';
  end if;
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception 'INVALID_PAYMENTS' using errcode = '22023'; end if;
    v_sum := v_sum + v_amount;
  end loop;
  if v_sum > v_order.total - v_order.paid_amount + 0.01 then
    raise exception 'PAYMENT_MISMATCH' using errcode = '22023';
  end if;
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := (v_pay ->> 'method')::public.payment_method;
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    v_tendered := nullif(v_pay ->> 'tendered', '')::numeric;
    if v_method = 'cash' and v_tendered is not null and v_tendered < v_amount then
      raise exception 'INSUFFICIENT_CASH' using errcode = '22023';
    end if;
    insert into public.payments (order_id, method, amount, tendered, change_given)
    values (p_order_id, v_method, v_amount,
      case when v_method = 'cash' then coalesce(v_tendered, v_amount) end,
      case when v_method = 'cash' then greatest(coalesce(v_tendered, v_amount) - v_amount, 0) else 0 end);
  end loop;
  perform public.write_audit('add_payment', 'order', p_order_id, jsonb_build_object('order_number', v_order.order_number, 'amount', v_sum));
  return public.order_json(p_order_id);
end;
$$;

-- edits on an unpaid order must not create refunds
create or replace function public.recalc_order(p_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_sub numeric;
  v_cost numeric;
  v_disc numeric;
  v_total numeric;
  v_vat numeric;
  v_paid numeric;
  v_delta numeric := 0;
  v_was_paid boolean;
  v_method public.payment_method;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  select coalesce(sum(amount), 0) into v_paid from public.payments where order_id = p_order_id;
  v_was_paid := v_paid >= v_order.total - 0.009;
  select coalesce(sum(line_total), 0), coalesce(sum(unit_cost_snapshot * quantity), 0)
    into v_sub, v_cost
  from public.order_items where order_id = p_order_id and voided_at is null;
  v_disc := case v_order.discount_type
    when 'percent' then round(v_sub * v_order.discount_value / 100, 2)
    when 'fixed' then least(v_order.discount_value, v_sub)
    else 0 end;
  v_total := v_sub - v_disc;
  select vat_percent into v_vat from public.restaurant_settings limit 1;
  update public.orders set
    subtotal = v_sub, discount_amount = v_disc, total = v_total,
    vat_amount = round(v_total * coalesce(v_vat, 0) / (100 + coalesce(v_vat, 0)), 2), cost_total = round(v_cost, 2)
  where id = p_order_id;

  if v_was_paid then
    v_delta := round(v_total - v_paid, 2);           -- paid orders: refund or charge the difference
  elsif v_paid > v_total + 0.009 then
    v_delta := round(v_total - v_paid, 2);           -- part-paid orders: refund only what was overpaid
  end if;
  if abs(v_delta) >= 0.01 then
    select method into v_method from public.payments where order_id = p_order_id and amount > 0
    order by (method = 'cash') desc, amount desc limit 1;
    insert into public.payments (order_id, method, amount, tendered, change_given)
    values (p_order_id, coalesce(v_method, 'cash'), v_delta, null, 0);
  end if;
  return v_delta;
end;
$$;
revoke execute on function public.recalc_order(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Salary advances (from the cashier drawer, deducted in payroll)
-- ---------------------------------------------------------------------
create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees_meta (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 200),
  shift_id uuid references public.cash_shifts (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists salary_advances_emp_idx on public.salary_advances (employee_id, created_at);
alter table public.salary_advances enable row level security;
drop policy if exists salary_advances_select on public.salary_advances;
create policy salary_advances_select on public.salary_advances for select to authenticated
  using (public.has_perm('employees')
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));

create or replace function public.record_advance(p_employee_id uuid, p_amount numeric, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.require_role('owner', 'manager', 'cashier');
  v_shift uuid;
  v_id uuid;
  v_name text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  select full_name into v_name from public.employees_meta where id = p_employee_id and is_active;
  if v_name is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select id into v_shift from public.cash_shifts where cashier_id = auth.uid() and closed_at is null;
  if v_shift is null and v_role = 'cashier' then
    raise exception 'SHIFT_REQUIRED' using errcode = '22023';
  end if;
  insert into public.salary_advances (employee_id, amount, note, shift_id, created_by)
  values (p_employee_id, round(p_amount, 2), left(coalesce(p_note, ''), 200), v_shift, auth.uid())
  returning id into v_id;
  perform public.write_audit('record_advance', 'salary_advance', v_id, jsonb_build_object('label', v_name, 'amount', round(p_amount, 2)));
  return v_id;
end;
$$;

-- staff list for the advance picker and the attendance kiosk (names only)
create or replace function public.staff_board()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'full_name', e.full_name, 'avatar_url', e.avatar_url, 'position', e.position,
      'open_since', (select a.clock_in from public.attendance a where a.employee_id = e.id and a.clock_out is null)
    ) order by e.full_name), '[]'::jsonb)
  from public.employees_meta e
  where e.is_active and public.current_user_role() is not null
$$;

-- attendance kiosk: any signed-in staff device can clock any active employee in/out
create or replace function public.kiosk_clock(p_employee_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.attendance;
begin
  if public.current_user_role() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees_meta where id = p_employee_id and is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_action = 'in' then
    if exists (select 1 from public.attendance where employee_id = p_employee_id and clock_out is null) then
      raise exception 'ALREADY_CLOCKED_IN' using errcode = '22023';
    end if;
    insert into public.attendance (employee_id) values (p_employee_id) returning * into v;
  elsif p_action = 'out' then
    update public.attendance set clock_out = now() where employee_id = p_employee_id and clock_out is null returning * into v;
    if v.id is null then raise exception 'NOT_CLOCKED_IN' using errcode = '22023'; end if;
  else
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;
  return to_jsonb(v);
end;
$$;

-- shift money: payments taken in this shift, minus advances paid from the drawer
create or replace function public.shift_cash(p_shift_id uuid)
returns table (cash numeric, card numeric, change_given numeric, advances numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
    coalesce(sum(p.change_given), 0),
    (select coalesce(sum(amount), 0) from public.salary_advances where shift_id = p_shift_id)
  from public.payments p join public.orders o on o.id = p.order_id
  where p.shift_id = p_shift_id and o.status not in ('cancelled', 'refunded')
$$;
revoke execute on function public.shift_cash(uuid) from public, anon, authenticated;

create or replace function public.shift_report(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.cash_shifts;
  m record;
begin
  perform public.require_role('owner', 'manager', 'cashier');
  select * into v from public.cash_shifts where id = p_shift_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.cashier_id <> auth.uid() and not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into m from public.shift_cash(p_shift_id);

  return jsonb_build_object(
    'shift', to_jsonb(v),
    'cashier_name', (select full_name from public.profiles where id = v.cashier_id),
    'cash_sales', m.cash,
    'card_sales', m.card,
    'advances', m.advances,
    'expected_cash', coalesce(v.expected_cash, v.opening_float + m.cash - m.advances),
    'unpaid_count', (select count(*) from public.orders where shift_id = p_shift_id and status not in ('cancelled', 'refunded') and payment_status <> 'paid'),
    'unpaid_total', (select coalesce(sum(total - paid_amount), 0) from public.orders where shift_id = p_shift_id and status not in ('cancelled', 'refunded') and payment_status <> 'paid'),
    'orders_count', (select count(*) from public.orders where shift_id = p_shift_id and status not in ('cancelled', 'refunded')),
    'voided_count', (select count(*) from public.orders where shift_id = p_shift_id and status in ('cancelled', 'refunded')),
    'voided_total', (select coalesce(sum(total), 0) from public.orders where shift_id = p_shift_id and status in ('cancelled', 'refunded')),
    'discount_total', (select coalesce(sum(discount_amount), 0) from public.orders where shift_id = p_shift_id and status not in ('cancelled', 'refunded')),
    'gross_total', (select coalesce(sum(total), 0) from public.orders where shift_id = p_shift_id and status not in ('cancelled', 'refunded')),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', type, 'orders', c, 'total', t))
      from (select type, count(*) c, sum(total) t from public.orders
            where shift_id = p_shift_id and status not in ('cancelled', 'refunded') group by type) s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.close_shift(p_counted_cash numeric, p_notes text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.cash_shifts;
  m record;
begin
  perform public.require_role('owner', 'manager', 'cashier');
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  select * into v from public.cash_shifts where cashier_id = auth.uid() and closed_at is null for update;
  if not found then
    raise exception 'NO_OPEN_SHIFT' using errcode = 'P0002';
  end if;
  select * into m from public.shift_cash(v.id);
  update public.cash_shifts set
    cash_sales = m.cash, card_sales = m.card, expected_cash = opening_float + m.cash - m.advances,
    counted_cash = round(p_counted_cash, 2), notes = left(coalesce(p_notes, ''), 500), closed_at = now()
  where id = v.id;
  perform public.write_audit('close_shift', 'cash_shift', v.id,
    jsonb_build_object('expected', v.opening_float + m.cash - m.advances, 'counted', p_counted_cash));
  return public.shift_report(v.id);
end;
$$;

create or replace function public.refresh_shift_totals(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from public.shift_cash(p_shift_id);
  update public.cash_shifts s set
    cash_sales = m.cash, card_sales = m.card, expected_cash = s.opening_float + m.cash - m.advances
  where s.id = p_shift_id and s.closed_at is not null;
end;
$$;
revoke execute on function public.refresh_shift_totals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Daily wage + payroll cycle (default: 12th to 12th)
-- ---------------------------------------------------------------------
alter type public.salary_type add value if not exists 'daily';
alter table public.restaurant_settings add column if not exists payroll_cycle_day integer not null default 12
  check (payroll_cycle_day between 1 and 28);
alter table public.payroll add column if not exists days_worked integer not null default 0;

create or replace function public.payroll_range(p_month date)
returns table (start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    (date_trunc('month', p_month)::date + (s.payroll_cycle_day - 1))::timestamp at time zone public.restaurant_tz(),
    ((date_trunc('month', p_month) + interval '1 month')::date + (s.payroll_cycle_day - 1))::timestamp at time zone public.restaurant_tz()
  from public.restaurant_settings s limit 1
$$;

create or replace function public.compute_payroll(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_start timestamptz;
  v_end timestamptz;
  v_emp record;
  v_hours numeric;
  v_days integer;
  v_adv numeric;
  v_base numeric;
  v_n integer := 0;
begin
  perform public.require_perm('employees');
  select start_at, end_at into v_start, v_end from public.payroll_range(v_month);
  for v_emp in select * from public.employees_meta where is_active loop
    select coalesce(sum(extract(epoch from (clock_out - clock_in)) / 3600), 0),
           count(distinct (clock_in at time zone public.restaurant_tz())::date)
      into v_hours, v_days
    from public.attendance
    where employee_id = v_emp.id and clock_in >= v_start and clock_in < v_end
      and (clock_out is not null or v_emp.salary_type::text = 'daily');
    select coalesce(sum(amount), 0) into v_adv
    from public.salary_advances where employee_id = v_emp.id and created_at >= v_start and created_at < v_end;
    v_base := case v_emp.salary_type::text
      when 'hourly' then round(v_hours * v_emp.salary_amount, 2)
      when 'daily' then round(v_days * v_emp.salary_amount, 2)
      else v_emp.salary_amount end;
    insert into public.payroll (employee_id, period_month, hours_worked, days_worked, base_amount, advances)
    values (v_emp.id, v_month, round(v_hours, 2), v_days, v_base, v_adv)
    on conflict (employee_id, period_month) do update
      set hours_worked = excluded.hours_worked, days_worked = excluded.days_worked,
          base_amount = excluded.base_amount, advances = excluded.advances
      where public.payroll.status = 'draft';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Printers and routing (kitchen station per category / item)
-- ---------------------------------------------------------------------
create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'kitchen' check (kind in ('kitchen', 'receipt')),
  connection text not null default 'wifi' check (connection in ('wifi', 'bluetooth', 'usb')),
  address text not null default '' check (char_length(address) <= 120),
  paper_width integer not null default 80 check (paper_width in (58, 80)),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.printers enable row level security;
drop trigger if exists printers_updated_at on public.printers;
create trigger printers_updated_at before update on public.printers for each row execute function public.set_updated_at();
drop policy if exists printers_select on public.printers;
create policy printers_select on public.printers for select to authenticated using (public.current_user_role() is not null);
drop policy if exists printers_write on public.printers;
create policy printers_write on public.printers for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
alter table public.restaurant_settings add column if not exists print_kitchen_on_send boolean not null default true;
alter table public.categories add column if not exists printer_id uuid references public.printers (id) on delete set null;
alter table public.menu_items add column if not exists printer_id uuid references public.printers (id) on delete set null;
grant select (printer_id) on public.menu_items to authenticated;

-- ---------------------------------------------------------------------
-- 10. delete_record: permission checks + customers and advances
-- ---------------------------------------------------------------------
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.delete_record(text, uuid, boolean)'::regprocedure);
  def := replace(def, $r$  case p_entity
  -- ---------------------------------------------------------------- order$r$, $r$  if p_entity in ('employee', 'attendance', 'payroll', 'work_shift', 'advance') then
    perform public.require_perm('employees');
  elsif p_entity = 'expense' then
    perform public.require_perm('reports');
  elsif p_entity = 'customer' then
    perform public.require_perm('customers');
  end if;

  case p_entity
  -- ---------------------------------------------------------------- order$r$);
  def := replace(def, $r$  when 'cash_shift' then$r$, $r$  when 'customer' then
    select count(*) into v_n from public.orders where customer_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'customer_orders_kept'); end if;
    if not p_dry_run then delete from public.customers where id = p_id; end if;

  when 'advance' then
    if exists (select 1 from public.salary_advances a join public.cash_shifts s on s.id = a.shift_id where a.id = p_id and s.closed_at is not null) then
      v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'shift_recalc');
    end if;
    if not p_dry_run then
      select shift_id into v_child from public.salary_advances where id = p_id;
      delete from public.salary_advances where id = p_id;
      if v_child is not null then perform public.refresh_shift_totals(v_child); end if;
    end if;

  when 'cash_shift' then$r$);
  if position($q$when 'customer'$q$ in def) = 0 or position('require_perm(''employees'')' in def) = 0 then
    raise exception 'delete_record patch failed';
  end if;
  execute def;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Activity log + realtime for the new tables
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'menu_item_options', 'printers', 'user_permissions', 'salary_advances'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    if t <> 'salary_advances' then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- user_permissions has no id column: log it by user
create or replace function public.audit_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  insert into public.audit_log (user_id, action, entity, entity_id, details)
  values (auth.uid(), lower(tg_op), 'user_permissions', r.user_id,
          jsonb_build_object('label', (select full_name from public.profiles where id = r.user_id),
                             'permission', r.permission, 'expires_at', r.expires_at));
  return null;
end;
$$;
drop trigger if exists user_permissions_audit on public.user_permissions;
create trigger user_permissions_audit after insert or update or delete on public.user_permissions
for each row execute function public.audit_permissions();

-- ---------------------------------------------------------------------
-- 12. Function grants
-- ---------------------------------------------------------------------
revoke execute on function public.grant_select_except(text, text[]), public.guard_cost_columns(),
  public.refresh_customer(uuid), public.orders_customer_sync(), public.orders_customer_totals(),
  public.payments_set_shift(), public.refresh_payment_status(uuid), public.payments_status_trigger(),
  public.orders_status_trigger(), public.audit_permissions(), public.menu_item_cost(uuid)
  from public, anon, authenticated;
grant execute on function public.has_perm(text), public.my_permissions(), public.cost_data(), public.po_item_costs(uuid),
  public.find_customers(text), public.add_payment(uuid, jsonb), public.record_advance(uuid, numeric, text),
  public.staff_board(), public.kiosk_clock(uuid, text), public.apply_stock_count(uuid), public.report_inventory(date, date)
  to authenticated;
