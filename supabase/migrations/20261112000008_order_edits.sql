-- =====================================================================
-- Editing orders after they were sent: cancel an item (or part of its quantity),
-- replace an item, or cancel the whole order from the kitchen.
-- Stock is restored/deducted through recipes; money differences are recorded as
-- payment adjustments (negative = refund to customer, positive = collect).
-- =====================================================================

alter table public.order_items
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references public.profiles (id) on delete set null;

-- Who may edit an order: owner/manager always; kitchen while it is in the kitchen; a cashier on their own orders.
create or replace function public.assert_can_edit_order(p_order public.orders)
returns public.app_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.require_role('owner', 'manager', 'kitchen', 'cashier');
begin
  if p_order.status in ('cancelled', 'refunded') then
    raise exception 'ALREADY_VOIDED' using errcode = '22023';
  end if;
  if v_role in ('kitchen', 'cashier') and p_order.status not in ('new', 'preparing', 'ready') then
    raise exception 'ORDER_CLOSED' using errcode = '22023';
  end if;
  if v_role = 'cashier' and p_order.cashier_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Moves stock for `p_qty` units of a menu item (positive restores, negative deducts).
create or replace function public.move_item_stock(p_menu_item_id uuid, p_qty integer, p_reason public.stock_reason, p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  for v_r in
    select ri.ingredient_id, ri.quantity * public.unit_factor(ri.unit, i.unit) as per_unit
    from public.recipe_items ri join public.ingredients i on i.id = ri.ingredient_id
    where ri.menu_item_id = p_menu_item_id
  loop
    perform public.apply_stock_change(v_r.ingredient_id, v_r.per_unit * p_qty, p_reason, p_order_id, p_note);
  end loop;
end;
$$;

-- Recomputes totals from the live items and records the money difference.
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
  v_delta numeric;
  v_method public.payment_method;
begin
  select * into v_order from public.orders where id = p_order_id for update;
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

  select coalesce(sum(amount), 0) into v_paid from public.payments where order_id = p_order_id;
  v_delta := round(v_total - v_paid, 2);
  if abs(v_delta) >= 0.01 then
    -- refunds/extra charges use cash when the order had cash, otherwise the original method
    select method into v_method from public.payments where order_id = p_order_id and amount > 0
    order by (method = 'cash') desc, amount desc limit 1;
    insert into public.payments (order_id, method, amount, tendered, change_given)
    values (p_order_id, coalesce(v_method, 'cash'), v_delta, null, 0);
  end if;
  return v_delta;
end;
$$;

-- Cancel `p_quantity` units of one order line.
create or replace function public.void_order_item(p_item_id uuid, p_quantity integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items;
  v_order public.orders;
  v_qty integer;
  v_delta numeric := 0;
begin
  select * into v_item from public.order_items where id = p_item_id for update;
  if not found or v_item.voided_at is not null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  perform public.assert_can_edit_order(v_order);
  if char_length(trim(coalesce(p_reason, ''))) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  v_qty := least(coalesce(p_quantity, v_item.quantity), v_item.quantity);
  if v_qty < 1 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  if v_item.menu_item_id is not null then
    perform public.move_item_stock(v_item.menu_item_id, v_qty, 'void', v_order.id, 'إلغاء صنف #' || v_order.order_number);
  end if;

  if v_qty = v_item.quantity then
    update public.order_items set voided_at = now(), void_reason = trim(p_reason), voided_by = auth.uid() where id = v_item.id;
  else
    -- keep the cancelled part as its own struck-through line for the history
    update public.order_items set quantity = quantity - v_qty, line_total = unit_price_snapshot * (quantity - v_qty) where id = v_item.id;
    insert into public.order_items (order_id, menu_item_id, name_snapshot, name_he_snapshot, unit_price_snapshot, unit_cost_snapshot,
      quantity, line_total, notes, kitchen_status, voided_at, void_reason, voided_by, created_at)
    values (v_item.order_id, v_item.menu_item_id, v_item.name_snapshot, v_item.name_he_snapshot, v_item.unit_price_snapshot,
      v_item.unit_cost_snapshot, v_qty, v_item.unit_price_snapshot * v_qty, v_item.notes, v_item.kitchen_status,
      now(), trim(p_reason), auth.uid(), v_item.created_at);
  end if;

  if not exists (select 1 from public.order_items where order_id = v_order.id and voided_at is null) then
    -- nothing left: the whole order is cancelled
    update public.orders set status = 'cancelled', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now() where id = v_order.id;
    update public.order_items set kitchen_status = 'served' where order_id = v_order.id;
  end if;
  v_delta := public.recalc_order(v_order.id);

  insert into public.notifications (type, title, body, ref_id, target_roles)
  values ('void', 'تعديل الطلب #' || v_order.order_number, 'إلغاء ' || v_qty || '× ' || v_item.name_snapshot || ' — ' || trim(p_reason),
          v_order.id, '{owner,manager,cashier}');
  perform public.write_audit('void_order_item', 'order', v_order.id,
    jsonb_build_object('order_number', v_order.order_number, 'item', v_item.name_snapshot, 'quantity', v_qty, 'reason', trim(p_reason), 'delta', v_delta));
  return public.order_json(v_order.id) || jsonb_build_object('money_delta', v_delta);
end;
$$;

-- Replace a whole line with another menu item.
create or replace function public.replace_order_item(p_item_id uuid, p_menu_item_id uuid, p_quantity integer, p_notes text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items;
  v_order public.orders;
  v_menu public.menu_items;
  v_qty integer := coalesce(p_quantity, 1);
  v_cost numeric;
  v_delta numeric;
begin
  select * into v_item from public.order_items where id = p_item_id for update;
  if not found or v_item.voided_at is not null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  perform public.assert_can_edit_order(v_order);
  if char_length(trim(coalesce(p_reason, ''))) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  if v_qty < 1 or v_qty > 999 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  select * into v_menu from public.menu_items where id = p_menu_item_id;
  if not found then
    raise exception 'MENU_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_menu.is_available then
    raise exception 'ITEM_UNAVAILABLE:%', v_menu.name_ar using errcode = '22023';
  end if;

  -- old line out (stock back)
  if v_item.menu_item_id is not null then
    perform public.move_item_stock(v_item.menu_item_id, v_item.quantity, 'void', v_order.id, 'استبدال صنف #' || v_order.order_number);
  end if;
  update public.order_items set voided_at = now(), void_reason = 'استبدال: ' || trim(p_reason), voided_by = auth.uid() where id = v_item.id;

  -- new line in (stock out)
  v_cost := public.menu_item_cost(v_menu.id);
  insert into public.order_items (order_id, menu_item_id, name_snapshot, name_he_snapshot, unit_price_snapshot, unit_cost_snapshot,
    quantity, line_total, notes, kitchen_status)
  values (v_order.id, v_menu.id, v_menu.name_ar, v_menu.name_he, v_menu.price, v_cost, v_qty, v_menu.price * v_qty,
    left(coalesce(p_notes, ''), 200), case when v_order.status = 'new' then 'new' else 'preparing' end::public.kitchen_status);
  perform public.move_item_stock(v_menu.id, -v_qty, 'sale', v_order.id, '#' || v_order.order_number);

  -- a new dish means the order is cooking again
  if v_order.status = 'ready' then
    update public.orders set status = 'preparing', ready_at = null where id = v_order.id;
    update public.order_items set kitchen_status = 'preparing' where order_id = v_order.id and voided_at is null;
  end if;
  v_delta := public.recalc_order(v_order.id);

  insert into public.notifications (type, title, body, ref_id, target_roles)
  values ('void', 'تعديل الطلب #' || v_order.order_number,
          'استبدال ' || v_item.name_snapshot || ' بـ ' || v_qty || '× ' || v_menu.name_ar || ' — ' || trim(p_reason),
          v_order.id, '{owner,manager,cashier}');
  perform public.write_audit('replace_order_item', 'order', v_order.id,
    jsonb_build_object('order_number', v_order.order_number, 'from', v_item.name_snapshot, 'to', v_menu.name_ar, 'quantity', v_qty, 'reason', trim(p_reason), 'delta', v_delta));
  return public.order_json(v_order.id) || jsonb_build_object('money_delta', v_delta);
end;
$$;

-- Whole-order cancel: now also allowed for the kitchen (and the cashier on their own order) while it is
-- still in the kitchen; refunds of served orders stay manager-only. Stock restore uses the net movements,
-- so items cancelled earlier are not restored twice.
create or replace function public.void_order(p_order_id uuid, p_reason text, p_refund boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_role public.app_role;
  v_mv record;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_role := public.assert_can_edit_order(v_order);
  if p_refund and v_role not in ('owner', 'manager') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.orders
  set status = case when p_refund then 'refunded'::public.order_status else 'cancelled'::public.order_status end,
      void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_order_id;
  update public.order_items set kitchen_status = 'served' where order_id = p_order_id;

  if not p_refund then
    for v_mv in
      select ingredient_id, sum(change) as qty from public.stock_movements
      where ref_id = p_order_id and reason in ('sale', 'void') group by ingredient_id having sum(change) <> 0
    loop
      perform public.apply_stock_change(v_mv.ingredient_id, -v_mv.qty, 'void', p_order_id, 'إلغاء #' || v_order.order_number);
    end loop;
  end if;

  insert into public.notifications (type, title, body, ref_id, target_roles)
  values ('void', case when p_refund then 'استرجاع الطلب #' else 'إلغاء الطلب #' end || v_order.order_number,
          trim(p_reason), p_order_id, '{owner,manager,cashier}');
  perform public.write_audit(case when p_refund then 'refund_order' else 'void_order' end, 'order', p_order_id,
    jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total, 'reason', trim(p_reason)));
  return public.order_json(p_order_id);
end;
$$;

-- Top-selling items must ignore cancelled lines
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
        and o.status not in ('cancelled', 'refunded') and oi.voided_at is null
      group by oi.menu_item_id
      order by sum(oi.quantity) desc
      limit greatest(1, least(coalesce(p_limit, 10), 100))
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.assert_can_edit_order(public.orders), public.move_item_stock(uuid, integer, public.stock_reason, uuid, text),
  public.recalc_order(uuid) from public, anon, authenticated;
grant execute on function public.void_order_item(uuid, integer, text), public.replace_order_item(uuid, uuid, integer, text, text),
  public.void_order(uuid, text, boolean), public.report_top_items(date, date, integer) to authenticated;
