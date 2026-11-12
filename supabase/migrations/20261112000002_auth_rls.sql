-- =====================================================================
-- Auth helpers, profile bootstrap and Row Level Security
-- NOTE: `current_role` is a reserved SQL keyword, so the role helper is
-- named public.current_user_role().
-- =====================================================================

-- Returns the role of the signed-in user, or NULL if not signed in / inactive.
create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = any(roles), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('owner', 'manager')
$$;

-- Raises a 42501 error unless the caller has one of the given roles.
create or replace function public.require_role(variadic roles public.app_role[])
returns public.app_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.app_role := public.current_user_role();
begin
  if r is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not (r = any(roles)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return r;
end;
$$;

-- Audit helper (only callable from other security definer functions)
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (user_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- Profile bootstrap: every auth user gets a profile.
-- Role comes ONLY from raw_app_meta_data (settable by service role only),
-- never from user-controlled raw_user_meta_data. The very first user of a
-- fresh install becomes the owner; any other self-signup is an inactive cashier.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_active boolean;
  v_first boolean;
begin
  select not exists (select 1 from public.profiles) into v_first;
  if new.raw_app_meta_data ? 'role' then
    v_role := (new.raw_app_meta_data ->> 'role')::public.app_role;
    v_active := true;
  elsif v_first then
    v_role := 'owner';
    v_active := true;
  else
    v_role := 'cashier';
    v_active := false;
  end if;

  insert into public.profiles (id, full_name, role, is_active, language)
  values (
    new.id,
    coalesce(nullif(new.raw_app_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_role,
    v_active,
    coalesce(nullif(new.raw_app_meta_data ->> 'language', ''), 'ar')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Called by the client right after sign-in.
create or replace function public.touch_last_login()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_login_at = now() where id = auth.uid();
$$;

-- Owner-only: change a user's role / active flag.
create or replace function public.admin_update_profile(p_user_id uuid, p_role public.app_role, p_is_active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.profiles;
begin
  perform public.require_role('owner');
  if p_user_id = auth.uid() and (p_role <> 'owner' or not p_is_active) then
    raise exception 'CANNOT_DEMOTE_SELF' using errcode = '22023';
  end if;
  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id returning * into v;
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.write_audit('update_role', 'profile', p_user_id, jsonb_build_object('role', p_role, 'is_active', p_is_active));
  return v;
end;
$$;

-- Set a 4–6 digit PIN. Users may set their own; owner/manager may set anyone's.
-- PINs must be unique across active users because PIN login identifies the user by PIN alone.
create or replace function public.set_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_user_id <> auth.uid() and not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_pin is null then
    update public.profiles set pin_hash = null where id = p_user_id;
    return;
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'INVALID_PIN' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.profiles
    where id <> p_user_id and is_active and pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash)
  ) then
    raise exception 'PIN_TAKEN' using errcode = '23505';
  end if;
  update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) where id = p_user_id;
  perform public.write_audit('set_pin', 'profile', p_user_id, '{}');
end;
$$;

-- Used by the pin-login Edge Function (service role only).
create or replace function public.verify_pin(p_pin text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select id from public.profiles
  where is_active
    and role in ('cashier', 'kitchen', 'manager', 'owner', 'inventory')
    and pin_hash is not null
    and p_pin ~ '^[0-9]{4,6}$'
    and pin_hash = extensions.crypt(p_pin, pin_hash)
  limit 1
$$;
revoke all on function public.verify_pin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Grants. Column-level grants keep secrets (pin_hash) out of reach.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on function public.write_audit(text, text, uuid, jsonb) from public, anon, authenticated;

revoke select, insert, update, delete on public.profiles from authenticated;
grant select (id, full_name, role, avatar_url, language, is_active, last_login_at, created_at, updated_at)
  on public.profiles to authenticated;
grant update (full_name, avatar_url, language) on public.profiles to authenticated;

-- Stock quantity can only change through audited functions.
revoke update on public.ingredients from authenticated;
grant update (name_ar, name_he, unit, min_quantity, cost_per_unit, image_url, supplier_id, is_active)
  on public.ingredients to authenticated;

revoke all on public.pin_attempts from authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_user_role() is not null);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role('owner'))
  with check (id = auth.uid() or public.has_role('owner'));

-- restaurant_settings
create policy settings_select on public.restaurant_settings for select to authenticated
  using (public.current_user_role() is not null);
create policy settings_update on public.restaurant_settings for update to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- menu
create policy categories_select on public.categories for select to authenticated
  using (public.current_user_role() is not null);
create policy categories_write on public.categories for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy menu_items_select on public.menu_items for select to authenticated
  using (public.current_user_role() is not null);
create policy menu_items_write on public.menu_items for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- inventory (owner, manager, inventory)
create policy suppliers_all on public.suppliers for all to authenticated
  using (public.has_role('owner', 'manager', 'inventory'))
  with check (public.has_role('owner', 'manager', 'inventory'));
create policy ingredients_select on public.ingredients for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy ingredients_insert on public.ingredients for insert to authenticated
  with check (public.has_role('owner', 'manager', 'inventory'));
create policy ingredients_update on public.ingredients for update to authenticated
  using (public.has_role('owner', 'manager', 'inventory'))
  with check (public.has_role('owner', 'manager', 'inventory'));
create policy ingredients_delete on public.ingredients for delete to authenticated
  using (public.is_manager());
create policy recipe_items_select on public.recipe_items for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy recipe_items_write on public.recipe_items for all to authenticated
  using (public.has_role('owner', 'manager', 'inventory'))
  with check (public.has_role('owner', 'manager', 'inventory'));
create policy po_select on public.purchase_orders for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy po_insert on public.purchase_orders for insert to authenticated
  with check (public.has_role('owner', 'manager', 'inventory') and status in ('draft', 'sent'));
create policy po_update on public.purchase_orders for update to authenticated
  using (public.has_role('owner', 'manager', 'inventory') and status in ('draft', 'sent'))
  with check (public.has_role('owner', 'manager', 'inventory') and status in ('draft', 'sent', 'cancelled'));
create policy po_delete on public.purchase_orders for delete to authenticated
  using (public.has_role('owner', 'manager', 'inventory') and status = 'draft');
create policy poi_select on public.purchase_order_items for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy poi_write on public.purchase_order_items for all to authenticated
  using (public.has_role('owner', 'manager', 'inventory')
    and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and po.status = 'draft'))
  with check (public.has_role('owner', 'manager', 'inventory')
    and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and po.status = 'draft'));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy stock_counts_select on public.stock_counts for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy stock_counts_insert on public.stock_counts for insert to authenticated
  with check (public.has_role('owner', 'manager', 'inventory') and status = 'draft');
create policy stock_counts_update on public.stock_counts for update to authenticated
  using (public.has_role('owner', 'manager', 'inventory') and status = 'draft')
  with check (status = 'draft');
create policy stock_counts_delete on public.stock_counts for delete to authenticated
  using (public.has_role('owner', 'manager', 'inventory') and status = 'draft');
create policy stock_count_items_select on public.stock_count_items for select to authenticated
  using (public.has_role('owner', 'manager', 'inventory'));
create policy stock_count_items_write on public.stock_count_items for all to authenticated
  using (public.has_role('owner', 'manager', 'inventory')
    and exists (select 1 from public.stock_counts c where c.id = stock_count_id and c.status = 'draft'))
  with check (public.has_role('owner', 'manager', 'inventory')
    and exists (select 1 from public.stock_counts c where c.id = stock_count_id and c.status = 'draft'));

-- orders: written only through functions
create policy orders_select on public.orders for select to authenticated
  using (
    public.is_manager()
    or (public.has_role('cashier') and cashier_id = auth.uid())
    or (public.has_role('kitchen') and status in ('new', 'preparing', 'ready'))
  );
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy payments_select on public.payments for select to authenticated
  using (
    public.is_manager()
    or exists (select 1 from public.orders o where o.id = order_id and o.cashier_id = auth.uid())
  );
create policy cash_shifts_select on public.cash_shifts for select to authenticated
  using (public.is_manager() or cashier_id = auth.uid());

-- employees (manager+, staff can read their own record)
create policy employees_select on public.employees_meta for select to authenticated
  using (public.is_manager() or profile_id = auth.uid());
create policy employees_write on public.employees_meta for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy work_shifts_select on public.work_shifts for select to authenticated
  using (public.is_manager()
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));
create policy work_shifts_write on public.work_shifts for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_manager()
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy payroll_select on public.payroll for select to authenticated
  using (public.is_manager()
    or exists (select 1 from public.employees_meta e where e.id = employee_id and e.profile_id = auth.uid()));
create policy payroll_write on public.payroll for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- expenses
create policy expenses_all on public.expenses for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- notifications: visible to the targeted roles; marking read goes through a function
create policy notifications_select on public.notifications for select to authenticated
  using (public.current_user_role() = any(target_roles));

-- audit log
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_manager());
