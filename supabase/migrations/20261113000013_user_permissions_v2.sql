-- =====================================================================
-- Per-user permissions: every screen / action is a permission with a default
-- per role. The owner can switch any of them on or off for any account
-- (switching on can be temporary). Enforced here, not only in the app.
-- =====================================================================

alter table public.user_permissions add column if not exists effect text not null default 'grant'
  check (effect in ('grant', 'deny'));
alter table public.user_permissions drop constraint if exists user_permissions_permission_check;
alter table public.user_permissions add constraint user_permissions_permission_check check (permission in (
  'pos', 'kitchen', 'orders', 'customers', 'menu', 'inventory', 'stocktake', 'stocktake_approve', 'receive_goods',
  'costs', 'attendance', 'employees', 'advance', 'reports', 'activity'));

-- what each role gets unless the owner says otherwise
create or replace function public.role_defaults(p_role public.app_role)
returns text[]
language sql
immutable
as $$
  select case p_role
    when 'owner' then array['pos', 'kitchen', 'orders', 'customers', 'menu', 'inventory', 'stocktake', 'stocktake_approve',
                            'receive_goods', 'costs', 'attendance', 'employees', 'advance', 'reports', 'activity']
    when 'manager' then array['pos', 'kitchen', 'orders', 'menu', 'inventory', 'stocktake', 'receive_goods', 'attendance', 'advance']
    when 'cashier' then array['pos', 'orders', 'stocktake', 'attendance', 'advance']
    when 'kitchen' then array['kitchen', 'attendance']
    when 'inventory' then array['inventory', 'stocktake', 'receive_goods', 'attendance']
    else array[]::text[] end
$$;

-- owner: everything. Others: an explicit "off" wins, then an unexpired "on", then the role default.
create or replace function public.has_perm(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r is null then false
    when r = 'owner' then true
    when exists (select 1 from public.user_permissions up where up.user_id = auth.uid() and up.permission = p and up.effect = 'deny') then false
    when exists (select 1 from public.user_permissions up where up.user_id = auth.uid() and up.permission = p and up.effect = 'grant'
                 and (up.expires_at is null or up.expires_at > now())) then true
    else p = any(public.role_defaults(r)) end
  from (select public.current_user_role() as r) x
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p), '{}')
  from unnest(public.role_defaults('owner')) p
  where public.has_perm(p)
$$;

-- ---------------------------------------------------------------------
-- Enforcement in functions
-- ---------------------------------------------------------------------
do $$
declare
  def text;
begin
  -- selling
  def := pg_get_functiondef('public.place_order(jsonb)'::regprocedure);
  def := replace(def, $r$  v_role := public.require_role('owner', 'manager', 'cashier');$r$,
    $r$  v_role := public.require_role('owner', 'manager', 'cashier', 'kitchen', 'inventory');
  perform public.require_perm('pos');$r$);
  if position($q$require_perm('pos')$q$ in def) = 0 then raise exception 'place_order patch failed'; end if;
  execute def;

  def := pg_get_functiondef('public.add_payment(uuid, jsonb)'::regprocedure);
  def := replace(def, $r$  v_role public.app_role := public.require_role('owner', 'manager', 'cashier');$r$,
    $r$  v_role public.app_role := public.require_role('owner', 'manager', 'cashier', 'kitchen', 'inventory');$r$);
  def := replace(def, $r$  select * into v_order from public.orders where id = p_order_id for update;$r$,
    $r$  if not (public.has_perm('pos') or public.has_perm('orders')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;$r$);
  execute def;

  -- advances from the drawer
  def := pg_get_functiondef('public.record_advance(uuid, numeric, text)'::regprocedure);
  def := replace(def, $r$  v_role public.app_role := public.require_role('owner', 'manager', 'cashier');$r$,
    $r$  v_role public.app_role := public.require_role('owner', 'manager', 'cashier', 'kitchen', 'inventory');$r$);
  def := replace(def, $r$  if p_amount is null or p_amount <= 0 or p_amount > 100000 then$r$,
    $r$  perform public.require_perm('advance');
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then$r$);
  execute def;

  -- kitchen board / marking served
  def := pg_get_functiondef('public.advance_kitchen_status(uuid, public.kitchen_status)'::regprocedure);
  def := replace(def, $r$  select * into v_order from public.orders where id = p_order_id for update;$r$,
    $r$  if not (public.has_perm('kitchen') or public.has_perm('orders')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;$r$);
  def := replace(def, $r$public.require_role('owner', 'manager', 'kitchen', 'cashier')$r$, $r$public.require_role('owner', 'manager', 'kitchen', 'cashier', 'inventory')$r$);
  execute def;

  -- goods receipt and purchase receiving
  def := pg_get_functiondef('public.receive_goods(jsonb, uuid, date, text)'::regprocedure);
  def := replace(def, $r$  perform public.require_role('owner', 'manager', 'inventory', 'cashier');$r$,
    $r$  if not (public.has_perm('receive_goods') or public.has_perm('inventory')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;$r$);
  execute def;
  def := pg_get_functiondef('public.receive_purchase_order(uuid)'::regprocedure);
  def := replace(def, $r$  perform public.require_role('owner', 'manager', 'inventory', 'cashier');$r$,
    $r$  if not (public.has_perm('receive_goods') or public.has_perm('inventory')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;$r$);
  execute def;

  -- stocktake: counting vs. approving the differences
  def := pg_get_functiondef('public.create_stock_count(text)'::regprocedure);
  def := replace(def, $r$  perform public.require_role('owner', 'manager', 'inventory', 'cashier');$r$, $r$  perform public.require_perm('stocktake');$r$);
  execute def;
  def := pg_get_functiondef('public.apply_stock_count_impl(uuid)'::regprocedure);
  def := replace(def, $r$  perform public.require_role('owner', 'manager', 'inventory');$r$, $r$  perform public.require_perm('stocktake_approve');$r$);
  execute def;
end;
$$;

-- ---------------------------------------------------------------------
-- Enforcement in table access
-- ---------------------------------------------------------------------
-- menu: everyone reads (the cashier sells from it); changing it needs 'menu'
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
  using (public.has_perm('menu')) with check (public.has_perm('menu'));
drop policy if exists menu_items_write on public.menu_items;
create policy menu_items_write on public.menu_items for all to authenticated
  using (public.has_perm('menu')) with check (public.has_perm('menu'));
drop policy if exists menu_item_options_write on public.menu_item_options;
create policy menu_item_options_write on public.menu_item_options for all to authenticated
  using (public.has_perm('menu')) with check (public.has_perm('menu'));

-- inventory back office
drop policy if exists suppliers_all on public.suppliers;
drop policy if exists suppliers_select_cashier on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (public.has_perm('inventory') or public.has_perm('receive_goods'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_perm('inventory')) with check (public.has_perm('inventory'));

drop policy if exists ingredients_select on public.ingredients;
create policy ingredients_select on public.ingredients for select to authenticated
  using (public.has_perm('inventory') or public.has_perm('stocktake') or public.has_perm('receive_goods') or public.has_perm('menu'));
drop policy if exists ingredients_insert on public.ingredients;
create policy ingredients_insert on public.ingredients for insert to authenticated with check (public.has_perm('inventory'));
drop policy if exists ingredients_update on public.ingredients;
create policy ingredients_update on public.ingredients for update to authenticated
  using (public.has_perm('inventory')) with check (public.has_perm('inventory'));
drop policy if exists ingredients_delete on public.ingredients;
create policy ingredients_delete on public.ingredients for delete to authenticated using (public.has_perm('inventory'));

drop policy if exists recipe_items_select on public.recipe_items;
create policy recipe_items_select on public.recipe_items for select to authenticated
  using (public.has_perm('inventory') or public.has_perm('menu'));
drop policy if exists recipe_items_write on public.recipe_items;
create policy recipe_items_write on public.recipe_items for all to authenticated
  using (public.has_perm('inventory')) with check (public.has_perm('inventory'));

drop policy if exists po_select on public.purchase_orders;
create policy po_select on public.purchase_orders for select to authenticated using (public.has_perm('inventory'));
drop policy if exists po_insert on public.purchase_orders;
create policy po_insert on public.purchase_orders for insert to authenticated
  with check (public.has_perm('inventory') and status in ('draft', 'sent'));
drop policy if exists po_update on public.purchase_orders;
create policy po_update on public.purchase_orders for update to authenticated
  using (public.has_perm('inventory') and status in ('draft', 'sent'))
  with check (public.has_perm('inventory') and status in ('draft', 'sent', 'cancelled'));
drop policy if exists po_delete on public.purchase_orders;
create policy po_delete on public.purchase_orders for delete to authenticated using (public.has_perm('inventory') and status = 'draft');
drop policy if exists poi_select on public.purchase_order_items;
create policy poi_select on public.purchase_order_items for select to authenticated using (public.has_perm('inventory'));
drop policy if exists poi_write on public.purchase_order_items;
create policy poi_write on public.purchase_order_items for all to authenticated
  using (public.has_perm('inventory') and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and po.status = 'draft'))
  with check (public.has_perm('inventory') and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and po.status = 'draft'));
drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select to authenticated using (public.has_perm('inventory'));

-- stocktake
drop policy if exists stock_counts_select on public.stock_counts;
create policy stock_counts_select on public.stock_counts for select to authenticated
  using (public.has_perm('stocktake') or public.has_perm('inventory'));
drop policy if exists stock_counts_insert on public.stock_counts;
create policy stock_counts_insert on public.stock_counts for insert to authenticated
  with check (public.has_perm('stocktake') and status = 'draft');
drop policy if exists stock_counts_update on public.stock_counts;
create policy stock_counts_update on public.stock_counts for update to authenticated
  using (public.has_perm('stocktake') and status = 'draft') with check (status = 'draft');
drop policy if exists stock_counts_delete on public.stock_counts;
create policy stock_counts_delete on public.stock_counts for delete to authenticated
  using ((public.has_perm('stocktake') or public.has_perm('inventory')) and status = 'draft');
drop policy if exists stock_count_items_select on public.stock_count_items;
create policy stock_count_items_select on public.stock_count_items for select to authenticated
  using (public.has_perm('stocktake') or public.has_perm('inventory'));
drop policy if exists stock_count_items_write on public.stock_count_items;
create policy stock_count_items_write on public.stock_count_items for all to authenticated
  using (public.has_perm('stocktake') and exists (select 1 from public.stock_counts c where c.id = stock_count_id and c.status = 'draft'))
  with check (public.has_perm('stocktake') and exists (select 1 from public.stock_counts c where c.id = stock_count_id and c.status = 'draft'));

-- attendance kiosk
do $$
declare
  def text;
begin
  foreach def in array array['public.kiosk_clock(uuid, text)', 'public.kiosk_absent(uuid, date)'] loop
    def := pg_get_functiondef(def::regprocedure);
    def := replace(def, $r$  if public.current_user_role() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;$r$,
      $r$  perform public.require_perm('attendance');$r$);
    execute def;
  end loop;
end;
$$;

grant execute on function public.role_defaults(public.app_role) to authenticated;

-- ---------------------------------------------------------------------
-- Spec §8/§9 locks that the owner cannot override:
--   purchase costs: the owner only · financial reports: owner, or a manager the owner allows
--   the cashier never sees reports, salaries or advances
-- ---------------------------------------------------------------------
create or replace function public.perm_locked(p_role public.app_role, p text)
returns boolean
language sql
immutable
as $$
  select p_role <> 'owner' and (
    p = 'costs'
    or (p in ('reports', 'activity') and p_role <> 'manager')
    or (p = 'employees' and p_role = 'cashier')
  )
$$;

create or replace function public.has_perm(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r is null then false
    when r = 'owner' then true
    when public.perm_locked(r, p) then false
    when exists (select 1 from public.user_permissions up where up.user_id = auth.uid() and up.permission = p and up.effect = 'deny') then false
    when exists (select 1 from public.user_permissions up where up.user_id = auth.uid() and up.permission = p and up.effect = 'grant'
                 and (up.expires_at is null or up.expires_at > now())) then true
    else p = any(public.role_defaults(r)) end
  from (select public.current_user_role() as r) x
$$;
grant execute on function public.perm_locked(public.app_role, text) to authenticated;

-- ---------------------------------------------------------------------
-- §7: an advance is part of the salary — the paid salary expense is the full
--     amount (net + advances already handed out), counted once.
-- ---------------------------------------------------------------------
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.payroll_paid_expense()'::regprocedure);
  def := replace(def, $r$new.net_amount > 0 then$r$, $r$new.net_amount + new.advances > 0 then$r$);
  def := replace(def, $r$values ('salaries', new.net_amount,$r$, $r$values ('salaries', new.net_amount + new.advances,$r$);
  if position('new.net_amount + new.advances,' in def) = 0 then raise exception 'payroll_paid_expense patch failed'; end if;
  execute def;
end;
$$;

-- ---------------------------------------------------------------------
-- §8: goods can be received without naming a supplier
-- ---------------------------------------------------------------------
alter table public.purchase_orders alter column supplier_id drop not null;
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.receive_goods(jsonb, uuid, date, text)'::regprocedure);
  def := replace(def, $r$  if p_supplier_id is null then
    raise exception 'SUPPLIER_REQUIRED' using errcode = '22023';
  end if;
$r$, '');
  execute def;
end;
$$;
