-- =====================================================================
-- Activity log: every change is recorded in audit_log (who, when, what changed).
-- Business functions already write explicit entries (voids, shifts, deletes, receipts…);
-- these triggers add every direct create/edit/delete and every sale.
-- =====================================================================

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_skip text[] := array['created_at', 'updated_at', 'quantity', 'cost_cache', 'total', 'pin_hash', 'read_by', 'last_login_at'];
  v_details jsonb;
  v_label text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)) into v_details
    from jsonb_each(v_new)
    where key <> all (v_skip) and (v_old -> key) is distinct from value;
    if v_details is null then
      return null; -- only noise columns changed (e.g. stock quantity from a sale)
    end if;
  end if;
  v_label := coalesce(v_new, v_old) ->> 'name_ar';
  v_label := coalesce(v_label, coalesce(v_new, v_old) ->> 'full_name', coalesce(v_new, v_old) ->> 'name', coalesce(v_new, v_old) ->> 'note');
  insert into public.audit_log (user_id, action, entity, entity_id, details)
  values (auth.uid(), lower(tg_op), tg_table_name, ((coalesce(v_new, v_old)) ->> 'id')::uuid,
          jsonb_build_object('label', v_label, 'changes', coalesce(v_details, '{}'::jsonb)));
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'menu_items', 'categories', 'ingredients', 'recipe_items', 'suppliers', 'expenses', 'employees_meta',
    'restaurant_settings', 'attendance', 'work_shifts', 'payroll', 'purchase_orders'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

-- every sale
create or replace function public.audit_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, entity, entity_id, details)
  values (auth.uid(), 'sale', 'order', new.id,
          jsonb_build_object('order_number', new.order_number, 'total', new.total, 'type', new.type, 'customer_phone', new.customer_phone));
  return null;
end;
$$;
drop trigger if exists orders_audit_sale on public.orders;
create trigger orders_audit_sale after insert on public.orders for each row execute function public.audit_sale();

revoke execute on function public.audit_row(), public.audit_sale() from public, anon, authenticated;
