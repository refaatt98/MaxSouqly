-- =====================================================================
-- Delete anything with full rollback, "as if it never happened".
--   delete_record(entity, id, dry_run)
--   dry_run = true  → returns the list of effects (for the confirmation dialog), changes nothing
--   dry_run = false → performs the rollback + delete and returns the same list
-- Effects: [{ t: 'stock', name, unit, change } | { t: 'cost', name, from, to } | { t: 'money', what, amount }
--           | { t: 'rows', what, count } | { t: 'note', what }]
-- =====================================================================

-- remember the cost before a purchase so a received PO can be undone exactly
alter table public.purchase_order_items add column if not exists cost_before numeric(12, 4);
-- link the automatic salary expense to its payroll row
alter table public.expenses add column if not exists payroll_id uuid references public.payroll (id) on delete cascade;

create or replace function public.receive_purchase_order(p_po_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
  v_line record;
  v_ing public.ingredients;
  v_new_cost numeric;
begin
  perform public.require_role('owner', 'manager', 'inventory');
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status not in ('draft', 'sent') then
    raise exception 'PO_NOT_RECEIVABLE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po_id) then
    raise exception 'EMPTY_ORDER' using errcode = '22023';
  end if;
  for v_line in select * from public.purchase_order_items where purchase_order_id = p_po_id loop
    select * into v_ing from public.ingredients where id = v_line.ingredient_id for update;
    update public.purchase_order_items set cost_before = v_ing.cost_per_unit where id = v_line.id;
    if greatest(v_ing.quantity, 0) + v_line.quantity > 0 then
      v_new_cost := (greatest(v_ing.quantity, 0) * v_ing.cost_per_unit + v_line.quantity * v_line.unit_cost)
                    / (greatest(v_ing.quantity, 0) + v_line.quantity);
    else
      v_new_cost := v_line.unit_cost;
    end if;
    perform public.apply_stock_change(v_line.ingredient_id, v_line.quantity, 'purchase', p_po_id, 'أمر شراء #' || v_po.po_number);
    if v_line.unit_cost > 0 then
      update public.ingredients set cost_per_unit = round(v_new_cost, 4) where id = v_line.ingredient_id;
    end if;
  end loop;
  update public.purchase_orders set status = 'received', received_at = now(), received_by = auth.uid(), sent_at = coalesce(sent_at, now())
  where id = p_po_id returning * into v_po;
  perform public.write_audit('receive_po', 'purchase_order', p_po_id, jsonb_build_object('total', v_po.total));
  return v_po;
end;
$$;

create or replace function public.payroll_paid_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.net_amount > 0 then
    insert into public.expenses (category, amount, note, expense_date, user_id, payroll_id)
    values ('salaries', new.net_amount,
            'راتب ' || (select full_name from public.employees_meta where id = new.employee_id) || ' — ' || to_char(new.period_month, 'YYYY-MM'),
            current_date, auth.uid(), new.id);
  elsif new.status = 'draft' and old.status = 'paid' then
    delete from public.expenses where payroll_id = new.id;
  end if;
  return null;
end;
$$;

-- Effects of reversing all stock movements that reference p_ref (optionally one movement only).
create or replace function public.movement_effects(p_ref uuid, p_movement uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('t', 'stock', 'name', i.name_ar, 'unit', i.unit, 'change', round(-x.total, 3))), '[]'::jsonb)
  from (
    select ingredient_id, sum(change) as total from public.stock_movements
    where (p_movement is null and ref_id = p_ref) or id = p_movement
    group by ingredient_id having sum(change) <> 0
  ) x join public.ingredients i on i.id = x.ingredient_id
$$;

-- Reverses (and deletes) the movements: stock goes back to what it would have been.
create or replace function public.undo_movements(p_ref uuid, p_movement uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  for v in
    select ingredient_id, sum(change) as total from public.stock_movements
    where (p_movement is null and ref_id = p_ref) or id = p_movement
    group by ingredient_id
  loop
    update public.ingredients set quantity = quantity - v.total where id = v.ingredient_id;
  end loop;
  delete from public.stock_movements where (p_movement is null and ref_id = p_ref) or id = p_movement;
end;
$$;

create or replace function public.refresh_shift_totals(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cash_shifts s set
    cash_sales = x.cash, card_sales = x.card, expected_cash = s.opening_float + x.cash
  from (
    select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) cash, coalesce(sum(p.amount) filter (where p.method = 'card'), 0) card
    from public.payments p join public.orders o on o.id = p.order_id
    where o.shift_id = p_shift_id and o.status not in ('cancelled', 'refunded')
  ) x
  where s.id = p_shift_id and s.closed_at is not null;
end;
$$;

create or replace function public.delete_record(p_entity text, p_id uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.require_role('owner', 'manager', 'inventory');
  v_fx jsonb := '[]'::jsonb;
  v_n integer;
  v_order public.orders;
  v_po public.purchase_orders;
  v_line record;
  v_ing public.ingredients;
  v_mv public.stock_movements;
  v_pay public.payroll;
  v_exp public.expenses;
  v_emp public.employees_meta;
  v_child uuid;
begin
  if v_role = 'inventory' and p_entity not in ('purchase_order', 'stock_count', 'stock_movement', 'ingredient', 'supplier') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  case p_entity
  -- ---------------------------------------------------------------- order
  when 'order' then
    select * into v_order from public.orders where id = p_id for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_fx := public.movement_effects(p_id);
    if v_order.status not in ('cancelled', 'refunded') then
      v_fx := v_fx || jsonb_build_object('t', 'money', 'what', 'sales', 'amount', -v_order.total);
    end if;
    select count(*) into v_n from public.payments where order_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'payments', 'count', v_n); end if;
    if v_order.shift_id is not null and exists (select 1 from public.cash_shifts where id = v_order.shift_id and closed_at is not null) then
      v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'shift_recalc');
    end if;
    if not p_dry_run then
      perform public.undo_movements(p_id);
      delete from public.notifications where ref_id = p_id;
      delete from public.orders where id = p_id; -- items + payments cascade
      if v_order.shift_id is not null then perform public.refresh_shift_totals(v_order.shift_id); end if;
    end if;

  -- ------------------------------------------------------- purchase order
  when 'purchase_order' then
    select * into v_po from public.purchase_orders where id = p_id for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_po.status = 'received' then
      v_fx := public.movement_effects(p_id);
      for v_line in
        select poi.cost_before, i.name_ar, i.cost_per_unit from public.purchase_order_items poi
        join public.ingredients i on i.id = poi.ingredient_id
        where poi.purchase_order_id = p_id and poi.cost_before is not null and poi.cost_before <> i.cost_per_unit
      loop
        v_fx := v_fx || jsonb_build_object('t', 'cost', 'name', v_line.name_ar, 'from', v_line.cost_per_unit, 'to', v_line.cost_before);
      end loop;
    end if;
    select count(*) into v_n from public.purchase_order_items where purchase_order_id = p_id;
    v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'po_lines', 'count', v_n);
    if not p_dry_run then
      if v_po.status = 'received' then
        update public.ingredients i set cost_per_unit = poi.cost_before
        from public.purchase_order_items poi
        where poi.purchase_order_id = p_id and poi.ingredient_id = i.id and poi.cost_before is not null;
        perform public.undo_movements(p_id);
      end if;
      delete from public.purchase_orders where id = p_id;
    end if;

  -- ----------------------------------------------------------- stock count
  when 'stock_count' then
    if not exists (select 1 from public.stock_counts where id = p_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_fx := public.movement_effects(p_id);
    if not p_dry_run then
      perform public.undo_movements(p_id);
      delete from public.stock_counts where id = p_id;
    end if;

  -- -------------------------------------------- single adjustment / waste
  when 'stock_movement' then
    select * into v_mv from public.stock_movements where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_mv.ref_id is not null then
      -- belongs to an order / purchase / stocktake: delete that instead
      raise exception 'DELETE_PARENT' using errcode = '22023';
    end if;
    v_fx := public.movement_effects(null, p_id);
    if not p_dry_run then perform public.undo_movements(null, p_id); end if;

  -- --------------------------------------------------------------- expense
  when 'expense' then
    select * into v_exp from public.expenses where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_fx := jsonb_build_array(jsonb_build_object('t', 'money', 'what', 'expenses', 'amount', -v_exp.amount));
    if v_exp.payroll_id is not null then v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'payroll_unpaid'); end if;
    if not p_dry_run then
      if v_exp.payroll_id is not null then
        update public.payroll set status = 'draft', paid_at = null where id = v_exp.payroll_id; -- trigger removes the expense
      end if;
      delete from public.expenses where id = p_id;
    end if;

  -- --------------------------------------------------------------- payroll
  when 'payroll' then
    select * into v_pay from public.payroll where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_pay.status = 'paid' then
      v_fx := jsonb_build_array(jsonb_build_object('t', 'money', 'what', 'expenses', 'amount', -v_pay.net_amount));
    end if;
    if not p_dry_run then delete from public.payroll where id = p_id; end if; -- its expense cascades

  -- --------------------------------------------------------------- catalog
  when 'menu_item' then
    if not exists (select 1 from public.menu_items where id = p_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    select count(*) into v_n from public.recipe_items where menu_item_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'recipe_items', 'count', v_n); end if;
    v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'history_kept');
    if not p_dry_run then delete from public.menu_items where id = p_id; end if;

  when 'category' then
    if not exists (select 1 from public.categories where id = p_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    select count(*) into v_n from public.menu_items where category_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'menu_items', 'count', v_n); end if;
    if not p_dry_run then
      delete from public.menu_items where category_id = p_id;
      delete from public.categories where id = p_id;
    end if;

  when 'ingredient' then
    select * into v_ing from public.ingredients where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    select count(*) into v_n from public.recipe_items where ingredient_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'recipe_items', 'count', v_n); end if;
    select count(*) into v_n from public.purchase_order_items where ingredient_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'po_lines', 'count', v_n); end if;
    select count(*) into v_n from public.stock_movements where ingredient_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'movements', 'count', v_n); end if;
    if not p_dry_run then
      delete from public.recipe_items where ingredient_id = p_id;
      delete from public.purchase_order_items where ingredient_id = p_id;
      delete from public.ingredients where id = p_id;
    end if;

  when 'supplier' then
    if not exists (select 1 from public.suppliers where id = p_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    select count(*) into v_n from public.purchase_orders where supplier_id = p_id;
    if v_n > 0 then
      v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'purchase_orders', 'count', v_n);
      for v_child in select id from public.purchase_orders where supplier_id = p_id and status = 'received' loop
        v_fx := v_fx || public.movement_effects(v_child);
      end loop;
    end if;
    if not p_dry_run then
      for v_child in select id from public.purchase_orders where supplier_id = p_id loop
        perform public.delete_record('purchase_order', v_child, false);
      end loop;
      delete from public.suppliers where id = p_id;
    end if;

  -- ------------------------------------------------------------------ staff
  when 'employee' then
    select * into v_emp from public.employees_meta where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    select count(*) into v_n from public.attendance where employee_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'attendance', 'count', v_n); end if;
    select count(*) into v_n from public.work_shifts where employee_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'work_shifts', 'count', v_n); end if;
    select count(*) into v_n from public.payroll where employee_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'rows', 'what', 'payroll', 'count', v_n); end if;
    if v_emp.profile_id is not null then
      if v_emp.profile_id = auth.uid() then raise exception 'CANNOT_DEMOTE_SELF' using errcode = '22023'; end if;
      v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'account_disabled');
    end if;
    if not p_dry_run then
      if v_emp.profile_id is not null then update public.profiles set is_active = false, pin_hash = null where id = v_emp.profile_id; end if;
      delete from public.employees_meta where id = p_id;
    end if;

  when 'attendance' then
    delete from public.attendance where id = p_id and not p_dry_run;
  when 'work_shift' then
    delete from public.work_shifts where id = p_id and not p_dry_run;

  when 'cash_shift' then
    select count(*) into v_n from public.orders where shift_id = p_id;
    if v_n > 0 then v_fx := v_fx || jsonb_build_object('t', 'note', 'what', 'orders_unlinked'); end if;
    if not p_dry_run then delete from public.cash_shifts where id = p_id; end if;

  else
    raise exception 'INVALID_ENTITY' using errcode = '22023';
  end case;

  if not p_dry_run then
    perform public.write_audit('delete', p_entity, p_id, jsonb_build_object('effects', v_fx));
  end if;
  return v_fx;
end;
$$;

revoke execute on function public.movement_effects(uuid, uuid), public.undo_movements(uuid, uuid), public.refresh_shift_totals(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_record(text, uuid, boolean) to authenticated;
