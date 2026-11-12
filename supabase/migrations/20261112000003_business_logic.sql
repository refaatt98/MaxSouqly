-- =====================================================================
-- Business logic: units, stock, orders, kitchen, shifts, inventory, staff
-- All mutating functions are SECURITY DEFINER with explicit role checks.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------
create or replace function public.unit_factor(p_from public.unit_type, p_to public.unit_type)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_from = p_to then return 1; end if;
  if p_from = 'g' and p_to = 'kg' then return 0.001; end if;
  if p_from = 'kg' and p_to = 'g' then return 1000; end if;
  if p_from = 'ml' and p_to = 'l' then return 0.001; end if;
  if p_from = 'l' and p_to = 'ml' then return 1000; end if;
  raise exception 'INCOMPATIBLE_UNITS % -> %', p_from, p_to using errcode = '22023';
end;
$$;

create or replace function public.check_recipe_unit()
returns trigger
language plpgsql
as $$
declare
  v_unit public.unit_type;
begin
  select unit into v_unit from public.ingredients where id = new.ingredient_id;
  perform public.unit_factor(new.unit, v_unit);
  return new;
end;
$$;
create trigger recipe_items_unit_check before insert or update on public.recipe_items
for each row execute function public.check_recipe_unit();

-- ---------------------------------------------------------------------
-- Menu cost cache (recipe × ingredient cost)
-- ---------------------------------------------------------------------
create or replace function public.menu_item_cost(p_menu_item_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(round(sum(ri.quantity * public.unit_factor(ri.unit, i.unit) * i.cost_per_unit), 2), 0)
  from public.recipe_items ri
  join public.ingredients i on i.id = ri.ingredient_id
  where ri.menu_item_id = p_menu_item_id
$$;

create or replace function public.refresh_cost_from_recipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.menu_items set cost_cache = public.menu_item_cost(new.menu_item_id) where id = new.menu_item_id;
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    update public.menu_items set cost_cache = public.menu_item_cost(old.menu_item_id) where id = old.menu_item_id;
  end if;
  return null;
end;
$$;
create trigger recipe_items_cost after insert or update or delete on public.recipe_items
for each row execute function public.refresh_cost_from_recipe();

create or replace function public.refresh_cost_from_ingredient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cost_per_unit is distinct from old.cost_per_unit or new.unit is distinct from old.unit then
    update public.menu_items m set cost_cache = public.menu_item_cost(m.id)
    where m.id in (select menu_item_id from public.recipe_items where ingredient_id = new.id);
  end if;
  return null;
end;
$$;
create trigger ingredients_cost after update on public.ingredients
for each row execute function public.refresh_cost_from_ingredient();

-- ---------------------------------------------------------------------
-- Stock core (internal — not callable by clients)
-- ---------------------------------------------------------------------
create or replace function public.apply_stock_change(
  p_ingredient_id uuid, p_change numeric, p_reason public.stock_reason, p_ref uuid, p_note text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_min numeric;
  v_name text;
begin
  select quantity, min_quantity, name_ar into v_before, v_min, v_name
  from public.ingredients where id = p_ingredient_id for update;
  if not found then
    raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_after := v_before + p_change;
  update public.ingredients set quantity = v_after where id = p_ingredient_id;
  insert into public.stock_movements (ingredient_id, change, quantity_after, reason, ref_id, note, user_id)
  values (p_ingredient_id, p_change, v_after, p_reason, p_ref, coalesce(p_note, ''), auth.uid());
  -- notify only when crossing the threshold, to avoid spamming on every sale
  if v_after <= v_min and v_before > v_min then
    insert into public.notifications (type, title, body, ref_id, target_roles)
    values ('low_stock', 'مخزون منخفض: ' || v_name,
            'الكمية الحالية ' || trim(to_char(v_after, 'FM999999990.###')) || ' — الحد الأدنى ' || trim(to_char(v_min, 'FM999999990.###')),
            p_ingredient_id, '{owner,manager,inventory}');
  end if;
  return v_after;
end;
$$;
revoke all on function public.apply_stock_change(uuid, numeric, public.stock_reason, uuid, text) from public, anon, authenticated;

-- initial quantity of a newly created ingredient is logged as an adjustment
create or replace function public.log_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quantity <> 0 then
    insert into public.stock_movements (ingredient_id, change, quantity_after, reason, note, user_id)
    values (new.id, new.quantity, new.quantity, 'adjustment', 'رصيد افتتاحي', auth.uid());
  end if;
  return null;
end;
$$;
create trigger ingredients_initial_stock after insert on public.ingredients
for each row execute function public.log_initial_stock();

-- Manual stock adjustment / waste
create or replace function public.adjust_stock(p_ingredient_id uuid, p_change numeric, p_reason public.stock_reason, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager', 'inventory');
  if p_reason not in ('adjustment', 'waste') then
    raise exception 'INVALID_REASON' using errcode = '22023';
  end if;
  if p_change = 0 or p_change is null then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  if p_reason = 'waste' and p_change > 0 then
    raise exception 'WASTE_MUST_BE_NEGATIVE' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  return public.apply_stock_change(p_ingredient_id, p_change, p_reason, null, p_note);
end;
$$;

-- ---------------------------------------------------------------------
-- place_order: the single, atomic entry point for every sale
-- payload: {
--   client_ref: uuid (idempotency key), type: 'dine_in'|'takeaway'|'delivery',
--   table_no?, customer_name?, customer_phone?, customer_address?, notes?,
--   discount?: { type: 'percent'|'fixed', value: number },
--   items: [{ menu_item_id, quantity, notes? }],
--   payments: [{ method: 'cash'|'card', amount, tendered? }],
--   offline_created_at?: timestamptz  (when queued offline)
-- }
-- ---------------------------------------------------------------------
create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_settings public.restaurant_settings;
  v_client_ref uuid;
  v_existing uuid;
  v_type public.order_type;
  v_table integer;
  v_shift uuid;
  v_order public.orders;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty integer;
  v_subtotal numeric := 0;
  v_cost numeric := 0;
  v_unit_cost numeric;
  v_disc_type public.discount_type;
  v_disc_value numeric := 0;
  v_disc_amount numeric := 0;
  v_max_pct numeric;
  v_total numeric;
  v_pay jsonb;
  v_pay_sum numeric := 0;
  v_method public.payment_method;
  v_amount numeric;
  v_tendered numeric;
  v_created timestamptz := now();
  v_recipe record;
  v_lines jsonb := '[]'::jsonb;
begin
  v_role := public.require_role('owner', 'manager', 'cashier');
  select * into v_settings from public.restaurant_settings limit 1;

  -- idempotency
  v_client_ref := nullif(payload ->> 'client_ref', '')::uuid;
  if v_client_ref is null then
    raise exception 'CLIENT_REF_REQUIRED' using errcode = '22023';
  end if;
  select id into v_existing from public.orders where client_ref = v_client_ref;
  if v_existing is not null then
    return public.order_json(v_existing);
  end if;

  -- order type & table / delivery details
  v_type := (payload ->> 'type')::public.order_type;
  if v_type is null then
    raise exception 'ORDER_TYPE_REQUIRED' using errcode = '22023';
  end if;
  v_table := nullif(payload ->> 'table_no', '')::integer;
  if v_type = 'dine_in' and (v_table is null or v_table < 1 or (v_settings.table_count > 0 and v_table > v_settings.table_count)) then
    raise exception 'INVALID_TABLE' using errcode = '22023';
  end if;
  if v_type = 'delivery' and (
    char_length(trim(coalesce(payload ->> 'customer_name', ''))) < 2
    or coalesce(payload ->> 'customer_phone', '') !~ '^[0-9+\- ]{7,20}$'
    or char_length(trim(coalesce(payload ->> 'customer_address', ''))) < 4
  ) then
    raise exception 'DELIVERY_DETAILS_REQUIRED' using errcode = '22023';
  end if;

  -- shift: cashiers must have an open shift
  select id into v_shift from public.cash_shifts where cashier_id = v_uid and closed_at is null;
  if v_shift is null and v_role = 'cashier' then
    raise exception 'SHIFT_REQUIRED' using errcode = '22023';
  end if;

  if jsonb_typeof(payload -> 'items') <> 'array' or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'EMPTY_ORDER' using errcode = '22023';
  end if;
  if jsonb_array_length(payload -> 'items') > 100 then
    raise exception 'TOO_MANY_ITEMS' using errcode = '22023';
  end if;

  -- offline orders keep their real sale time (bounded to the last 7 days)
  if payload ? 'offline_created_at' then
    v_created := least(now(), greatest(now() - interval '7 days', (payload ->> 'offline_created_at')::timestamptz));
  end if;

  -- price every line from the database, never from the client
  for v_item in select * from jsonb_array_elements(payload -> 'items') loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;
    select * into v_menu from public.menu_items where id = (v_item ->> 'menu_item_id')::uuid;
    if not found then
      raise exception 'MENU_ITEM_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not v_menu.is_available then
      raise exception 'ITEM_UNAVAILABLE:%', v_menu.name_ar using errcode = '22023';
    end if;
    v_unit_cost := public.menu_item_cost(v_menu.id);
    v_subtotal := v_subtotal + v_menu.price * v_qty;
    v_cost := v_cost + v_unit_cost * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_menu.id, 'name', v_menu.name_ar, 'name_he', v_menu.name_he,
      'price', v_menu.price, 'cost', v_unit_cost, 'qty', v_qty,
      'notes', left(coalesce(v_item ->> 'notes', ''), 200)
    );
  end loop;

  -- discount (role-limited)
  if payload -> 'discount' is not null and jsonb_typeof(payload -> 'discount') = 'object'
     and coalesce((payload -> 'discount' ->> 'value')::numeric, 0) > 0 then
    v_disc_type := (payload -> 'discount' ->> 'type')::public.discount_type;
    v_disc_value := (payload -> 'discount' ->> 'value')::numeric;
    if v_disc_type = 'percent' then
      if v_disc_value > 100 then
        raise exception 'INVALID_DISCOUNT' using errcode = '22023';
      end if;
      v_disc_amount := round(v_subtotal * v_disc_value / 100, 2);
    else
      v_disc_amount := round(v_disc_value, 2);
    end if;
    if v_disc_amount > v_subtotal then
      raise exception 'INVALID_DISCOUNT' using errcode = '22023';
    end if;
    v_max_pct := case v_role
      when 'owner' then 100
      when 'manager' then v_settings.max_discount_manager_percent
      else v_settings.max_discount_cashier_percent
    end;
    if v_subtotal > 0 and v_disc_amount > round(v_subtotal * v_max_pct / 100, 2) then
      raise exception 'DISCOUNT_LIMIT:%', v_max_pct using errcode = '42501';
    end if;
  end if;

  v_total := v_subtotal - v_disc_amount;

  -- payments must cover the total exactly (cash change is computed from `tendered`)
  if jsonb_typeof(coalesce(payload -> 'payments', '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_PAYMENTS' using errcode = '22023';
  end if;
  for v_pay in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb)) loop
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 then
      raise exception 'INVALID_PAYMENTS' using errcode = '22023';
    end if;
    v_pay_sum := v_pay_sum + v_amount;
  end loop;
  if abs(v_pay_sum - v_total) > 0.01 then
    raise exception 'PAYMENT_MISMATCH' using errcode = '22023';
  end if;

  insert into public.orders (
    client_ref, type, table_no, customer_name, customer_phone, customer_address, status,
    subtotal, discount_type, discount_value, discount_amount, total, vat_amount, cost_total,
    cashier_id, shift_id, notes, created_at
  ) values (
    v_client_ref, v_type, case when v_type = 'dine_in' then v_table end,
    left(trim(coalesce(payload ->> 'customer_name', '')), 120),
    left(trim(coalesce(payload ->> 'customer_phone', '')), 20),
    left(trim(coalesce(payload ->> 'customer_address', '')), 300),
    'new', v_subtotal, v_disc_type, v_disc_value, v_disc_amount, v_total,
    round(v_total * v_settings.vat_percent / (100 + v_settings.vat_percent), 2),
    round(v_cost, 2), v_uid, v_shift, left(coalesce(payload ->> 'notes', ''), 500), v_created
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (
      order_id, menu_item_id, name_snapshot, name_he_snapshot, unit_price_snapshot, unit_cost_snapshot,
      quantity, line_total, notes, created_at
    ) values (
      v_order.id, (v_item ->> 'menu_item_id')::uuid, v_item ->> 'name', v_item ->> 'name_he',
      (v_item ->> 'price')::numeric, (v_item ->> 'cost')::numeric, (v_item ->> 'qty')::integer,
      (v_item ->> 'price')::numeric * (v_item ->> 'qty')::integer, v_item ->> 'notes', v_created
    );
  end loop;

  for v_pay in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb)) loop
    v_method := (v_pay ->> 'method')::public.payment_method;
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    v_tendered := nullif(v_pay ->> 'tendered', '')::numeric;
    if v_method = 'cash' and v_tendered is not null and v_tendered < v_amount then
      raise exception 'INSUFFICIENT_CASH' using errcode = '22023';
    end if;
    insert into public.payments (order_id, method, amount, tendered, change_given, created_at)
    values (
      v_order.id, v_method, v_amount,
      case when v_method = 'cash' then coalesce(v_tendered, v_amount) end,
      case when v_method = 'cash' then greatest(coalesce(v_tendered, v_amount) - v_amount, 0) else 0 end,
      v_created
    );
  end loop;

  -- deduct stock via recipes (aggregated per ingredient)
  for v_recipe in
    select ri.ingredient_id, sum(ri.quantity * public.unit_factor(ri.unit, i.unit) * oi.quantity) as qty
    from public.order_items oi
    join public.recipe_items ri on ri.menu_item_id = oi.menu_item_id
    join public.ingredients i on i.id = ri.ingredient_id
    where oi.order_id = v_order.id
    group by ri.ingredient_id
  loop
    perform public.apply_stock_change(v_recipe.ingredient_id, -v_recipe.qty, 'sale', v_order.id, '#' || v_order.order_number);
  end loop;

  if v_settings.order_notifications then
    insert into public.notifications (type, title, body, ref_id, target_roles)
    values ('new_order', 'طلب جديد رقم #' || v_order.order_number,
            jsonb_array_length(v_lines) || ' أصناف', v_order.id, '{owner,manager,kitchen}');
  end if;

  return public.order_json(v_order.id);
end;
$$;

-- Full order as JSON (order + items + payments + cashier name)
create or replace function public.order_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(o)
    || jsonb_build_object(
      'cashier_name', (select full_name from public.profiles where id = o.cashier_id),
      'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.name_snapshot) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p where p.order_id = o.id), '[]'::jsonb)
    )
  from public.orders o
  where o.id = p_order_id
$$;
revoke all on function public.order_json(uuid) from public, anon, authenticated;

-- Readable order JSON for clients (respects visibility rules)
create or replace function public.get_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.require_role('owner', 'manager', 'cashier', 'kitchen');
  v_cashier uuid;
begin
  select cashier_id into v_cashier from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_role = 'cashier' and v_cashier is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.order_json(p_order_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Void (cancel + restore stock) and refund (no stock restore — food was served)
-- ---------------------------------------------------------------------
create or replace function public.void_order(p_order_id uuid, p_reason text, p_refund boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_mv record;
begin
  perform public.require_role('owner', 'manager');
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status in ('cancelled', 'refunded') then
    raise exception 'ALREADY_VOIDED' using errcode = '22023';
  end if;

  update public.orders
  set status = case when p_refund then 'refunded'::public.order_status else 'cancelled'::public.order_status end,
      void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_order_id;
  update public.order_items set kitchen_status = 'served' where order_id = p_order_id;

  if not p_refund then
    for v_mv in
      select ingredient_id, sum(change) as qty from public.stock_movements
      where ref_id = p_order_id and reason = 'sale' group by ingredient_id
    loop
      perform public.apply_stock_change(v_mv.ingredient_id, -v_mv.qty, 'void', p_order_id, 'إلغاء #' || v_order.order_number);
    end loop;
  end if;

  insert into public.notifications (type, title, body, ref_id, target_roles)
  values ('void', case when p_refund then 'استرجاع الطلب #' else 'إلغاء الطلب #' end || v_order.order_number,
          trim(p_reason), p_order_id, '{owner,manager}');
  perform public.write_audit(case when p_refund then 'refund_order' else 'void_order' end, 'order', p_order_id,
    jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total, 'reason', trim(p_reason)));
  return public.order_json(p_order_id);
end;
$$;

-- POS cart cancellation (before payment) is audited to detect abuse
create or replace function public.log_pos_cancel(p_reason text, p_items integer, p_total numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role('owner', 'manager', 'cashier');
  if char_length(trim(coalesce(p_reason, ''))) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  perform public.write_audit('cancel_cart', 'pos', null,
    jsonb_build_object('reason', trim(p_reason), 'items', p_items, 'total', p_total));
end;
$$;

-- ---------------------------------------------------------------------
-- Kitchen
-- ---------------------------------------------------------------------
create or replace function public.advance_kitchen_status(p_order_id uuid, p_status public.kitchen_status)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.require_role('owner', 'manager', 'kitchen', 'cashier');
  v_order public.orders;
  v_from integer;
  v_to integer;
  v_steps constant text[] := array['new', 'preparing', 'ready', 'served'];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status in ('cancelled', 'refunded', 'served') then
    raise exception 'ORDER_CLOSED' using errcode = '22023';
  end if;
  v_from := array_position(v_steps, v_order.status::text);
  v_to := array_position(v_steps, p_status::text);
  if abs(v_to - v_from) <> 1 then
    raise exception 'INVALID_TRANSITION' using errcode = '22023';
  end if;
  if v_role = 'cashier' and not (p_status = 'served' and v_order.cashier_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.orders set
    status = p_status::text::public.order_status,
    preparing_at = case when p_status = 'preparing' then coalesce(preparing_at, now()) else preparing_at end,
    ready_at = case when p_status = 'ready' then now() when p_status = 'preparing' then null else ready_at end,
    served_at = case when p_status = 'served' then now() else null end
  where id = p_order_id;
  update public.order_items set kitchen_status = p_status where order_id = p_order_id;
  return jsonb_build_object('id', p_order_id, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------
-- Cash shifts
-- ---------------------------------------------------------------------
create or replace function public.open_shift(p_opening_float numeric)
returns public.cash_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.cash_shifts;
begin
  perform public.require_role('owner', 'manager', 'cashier');
  if p_opening_float is null or p_opening_float < 0 or p_opening_float > 100000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_shifts where cashier_id = auth.uid() and closed_at is null) then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = '22023';
  end if;
  insert into public.cash_shifts (cashier_id, opening_float) values (auth.uid(), round(p_opening_float, 2)) returning * into v;
  perform public.write_audit('open_shift', 'cash_shift', v.id, jsonb_build_object('opening_float', v.opening_float));
  return v;
end;
$$;

create or replace function public.shift_report(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.cash_shifts;
  v_cash numeric;
  v_card numeric;
  v_change numeric;
begin
  perform public.require_role('owner', 'manager', 'cashier');
  select * into v from public.cash_shifts where id = p_shift_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.cashier_id <> auth.uid() and not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select
    coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
    coalesce(sum(p.change_given), 0)
  into v_cash, v_card, v_change
  from public.payments p join public.orders o on o.id = p.order_id
  where o.shift_id = p_shift_id and o.status not in ('cancelled', 'refunded');

  return jsonb_build_object(
    'shift', to_jsonb(v),
    'cashier_name', (select full_name from public.profiles where id = v.cashier_id),
    'cash_sales', v_cash,
    'card_sales', v_card,
    'expected_cash', coalesce(v.expected_cash, v.opening_float + v_cash),
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
  v_cash numeric;
  v_card numeric;
begin
  perform public.require_role('owner', 'manager', 'cashier');
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  select * into v from public.cash_shifts where cashier_id = auth.uid() and closed_at is null for update;
  if not found then
    raise exception 'NO_OPEN_SHIFT' using errcode = 'P0002';
  end if;
  select
    coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'card'), 0)
  into v_cash, v_card
  from public.payments p join public.orders o on o.id = p.order_id
  where o.shift_id = v.id and o.status not in ('cancelled', 'refunded');

  update public.cash_shifts set
    cash_sales = v_cash, card_sales = v_card, expected_cash = opening_float + v_cash,
    counted_cash = round(p_counted_cash, 2), notes = left(coalesce(p_notes, ''), 500), closed_at = now()
  where id = v.id;
  perform public.write_audit('close_shift', 'cash_shift', v.id,
    jsonb_build_object('expected', v.opening_float + v_cash, 'counted', p_counted_cash));
  return public.shift_report(v.id);
end;
$$;

-- ---------------------------------------------------------------------
-- Purchasing & stocktake
-- ---------------------------------------------------------------------
create or replace function public.refresh_po_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders
  set total = (select coalesce(sum(quantity * unit_cost), 0) from public.purchase_order_items where purchase_order_id = v_po)
  where id = v_po;
  return null;
end;
$$;
create trigger poi_total after insert or update or delete on public.purchase_order_items
for each row execute function public.refresh_po_total();

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
    -- weighted average cost
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
  update public.purchase_orders set status = 'received', received_at = now(), received_by = auth.uid(),
    sent_at = coalesce(sent_at, now())
  where id = p_po_id returning * into v_po;
  perform public.write_audit('receive_po', 'purchase_order', p_po_id, jsonb_build_object('total', v_po.total));
  return v_po;
end;
$$;

create or replace function public.create_stock_count(p_notes text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_role('owner', 'manager', 'inventory');
  insert into public.stock_counts (notes, created_by) values (left(coalesce(p_notes, ''), 500), auth.uid()) returning id into v_id;
  insert into public.stock_count_items (stock_count_id, ingredient_id, expected_quantity)
  select v_id, id, quantity from public.ingredients where is_active order by name_ar;
  return v_id;
end;
$$;

create or replace function public.apply_stock_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
  v_line record;
  v_current numeric;
  v_changed integer := 0;
  v_value numeric := 0;
begin
  perform public.require_role('owner', 'manager', 'inventory');
  select * into v_count from public.stock_counts where id = p_count_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_count.status <> 'draft' then
    raise exception 'ALREADY_APPLIED' using errcode = '22023';
  end if;
  for v_line in
    select sci.*, i.cost_per_unit from public.stock_count_items sci
    join public.ingredients i on i.id = sci.ingredient_id
    where sci.stock_count_id = p_count_id and sci.counted_quantity is not null
  loop
    select quantity into v_current from public.ingredients where id = v_line.ingredient_id;
    if v_line.counted_quantity <> v_current then
      perform public.apply_stock_change(v_line.ingredient_id, v_line.counted_quantity - v_current, 'adjustment', p_count_id,
        'جرد' || case when v_line.reason <> '' then ': ' || v_line.reason else '' end);
      v_changed := v_changed + 1;
      v_value := v_value + (v_line.counted_quantity - v_current) * v_line.cost_per_unit;
    end if;
  end loop;
  update public.stock_counts set status = 'applied', applied_at = now(), applied_by = auth.uid() where id = p_count_id;
  perform public.write_audit('apply_stock_count', 'stock_count', p_count_id, jsonb_build_object('changed', v_changed, 'value', round(v_value, 2)));
  return jsonb_build_object('changed', v_changed, 'variance_value', round(v_value, 2));
end;
$$;

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_user_role();
begin
  if v_role is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  update public.notifications
  set read_by = array_append(read_by, auth.uid())
  where v_role = any(target_roles)
    and not (auth.uid() = any(read_by))
    and (p_ids is null or id = any(p_ids));
end;
$$;

-- ---------------------------------------------------------------------
-- Attendance & payroll
-- ---------------------------------------------------------------------
create or replace function public.resolve_employee(p_employee_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_employee_id is null then
    select id into v_id from public.employees_meta where profile_id = auth.uid() and is_active;
    if v_id is null then
      raise exception 'NO_EMPLOYEE_RECORD' using errcode = 'P0002';
    end if;
    return v_id;
  end if;
  if not public.is_manager()
     and not exists (select 1 from public.employees_meta where id = p_employee_id and profile_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return p_employee_id;
end;
$$;
revoke all on function public.resolve_employee(uuid) from public, anon, authenticated;

create or replace function public.clock_in(p_employee_id uuid default null)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.resolve_employee(p_employee_id);
  v public.attendance;
begin
  if exists (select 1 from public.attendance where employee_id = v_emp and clock_out is null) then
    raise exception 'ALREADY_CLOCKED_IN' using errcode = '22023';
  end if;
  insert into public.attendance (employee_id) values (v_emp) returning * into v;
  return v;
end;
$$;

create or replace function public.clock_out(p_employee_id uuid default null)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.resolve_employee(p_employee_id);
  v public.attendance;
begin
  update public.attendance set clock_out = now()
  where employee_id = v_emp and clock_out is null
  returning * into v;
  if v.id is null then
    raise exception 'NOT_CLOCKED_IN' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.payroll_net()
returns trigger
language plpgsql
as $$
begin
  new.net_amount := new.base_amount + new.bonuses - new.advances - new.deductions;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end;
$$;
create trigger payroll_net before insert or update on public.payroll
for each row execute function public.payroll_net();

-- Paying a salary records a "salaries" expense so profit reports include it.
create or replace function public.payroll_paid_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.net_amount > 0 then
    insert into public.expenses (category, amount, note, expense_date, user_id)
    values ('salaries', new.net_amount,
            'راتب ' || (select full_name from public.employees_meta where id = new.employee_id) || ' — ' || to_char(new.period_month, 'YYYY-MM'),
            current_date, auth.uid());
  end if;
  return null;
end;
$$;
create trigger payroll_paid after update on public.payroll
for each row execute function public.payroll_paid_expense();

create or replace function public.compute_payroll(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_emp record;
  v_hours numeric;
  v_base numeric;
  v_n integer := 0;
begin
  perform public.require_role('owner', 'manager');
  for v_emp in select * from public.employees_meta where is_active loop
    select coalesce(sum(extract(epoch from (clock_out - clock_in)) / 3600), 0) into v_hours
    from public.attendance
    where employee_id = v_emp.id and clock_out is not null and clock_in >= v_start and clock_in < v_end;
    v_base := case when v_emp.salary_type = 'hourly' then round(v_hours * v_emp.salary_amount, 2) else v_emp.salary_amount end;
    insert into public.payroll (employee_id, period_month, hours_worked, base_amount)
    values (v_emp.id, v_start, round(v_hours, 2), v_base)
    on conflict (employee_id, period_month) do update
      set hours_worked = excluded.hours_worked, base_amount = excluded.base_amount
      where public.payroll.status = 'draft';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Backup import (owner only) — replaces catalog & inventory master data
-- ---------------------------------------------------------------------
create or replace function public.import_backup(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  perform public.require_role('owner');
  if jsonb_typeof(p_data) <> 'object' or (p_data ->> 'app') is distinct from 'MAX' then
    raise exception 'INVALID_BACKUP' using errcode = '22023';
  end if;

  if p_data ? 'restaurant_settings' and jsonb_typeof(p_data -> 'restaurant_settings') = 'array'
     and jsonb_array_length(p_data -> 'restaurant_settings') = 1 then
    update public.restaurant_settings s set
      name = coalesce(r.name, s.name), slogan = coalesce(r.slogan, s.slogan), logo_url = r.logo_url,
      phone = coalesce(r.phone, s.phone), address = coalesce(r.address, s.address),
      vat_percent = coalesce(r.vat_percent, s.vat_percent),
      receipt_header = coalesce(r.receipt_header, s.receipt_header), receipt_footer = coalesce(r.receipt_footer, s.receipt_footer),
      table_count = coalesce(r.table_count, s.table_count), seating_capacity = coalesce(r.seating_capacity, s.seating_capacity)
    from jsonb_populate_record(null::public.restaurant_settings, p_data -> 'restaurant_settings' -> 0) r;
  end if;

  if p_data ? 'categories' then
    insert into public.categories select * from jsonb_populate_recordset(null::public.categories, p_data -> 'categories')
    on conflict (id) do update set name_ar = excluded.name_ar, name_he = excluded.name_he, icon = excluded.icon,
      sort_order = excluded.sort_order, is_active = excluded.is_active;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('categories', v_n);
  end if;
  if p_data ? 'suppliers' then
    insert into public.suppliers select * from jsonb_populate_recordset(null::public.suppliers, p_data -> 'suppliers')
    on conflict (id) do update set name = excluded.name, contact_name = excluded.contact_name, phone = excluded.phone,
      email = excluded.email, address = excluded.address, notes = excluded.notes, is_active = excluded.is_active;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', v_n);
  end if;
  if p_data ? 'menu_items' then
    insert into public.menu_items select * from jsonb_populate_recordset(null::public.menu_items, p_data -> 'menu_items')
    on conflict (id) do update set category_id = excluded.category_id, name_ar = excluded.name_ar, name_he = excluded.name_he,
      description = excluded.description, price = excluded.price, image_url = excluded.image_url, barcode = excluded.barcode,
      is_available = excluded.is_available, sort_order = excluded.sort_order;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_items', v_n);
  end if;
  if p_data ? 'ingredients' then
    -- quantities are NOT overwritten: stock levels only change through audited movements
    insert into public.ingredients (id, name_ar, name_he, unit, quantity, min_quantity, cost_per_unit, image_url, supplier_id, is_active)
    select id, name_ar, name_he, unit, quantity, min_quantity, cost_per_unit, image_url, supplier_id, is_active
    from jsonb_populate_recordset(null::public.ingredients, p_data -> 'ingredients')
    on conflict (id) do update set name_ar = excluded.name_ar, name_he = excluded.name_he, unit = excluded.unit,
      min_quantity = excluded.min_quantity, cost_per_unit = excluded.cost_per_unit, image_url = excluded.image_url,
      supplier_id = excluded.supplier_id, is_active = excluded.is_active;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ingredients', v_n);
  end if;
  if p_data ? 'recipe_items' then
    insert into public.recipe_items select * from jsonb_populate_recordset(null::public.recipe_items, p_data -> 'recipe_items')
    on conflict (id) do update set quantity = excluded.quantity, unit = excluded.unit;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recipe_items', v_n);
  end if;
  if p_data ? 'employees_meta' then
    insert into public.employees_meta (id, full_name, position, phone, avatar_url, salary_type, salary_amount, hire_date, is_active)
    select id, full_name, position, phone, avatar_url, salary_type, salary_amount, hire_date, is_active
    from jsonb_populate_recordset(null::public.employees_meta, p_data -> 'employees_meta')
    on conflict (id) do update set full_name = excluded.full_name, position = excluded.position, phone = excluded.phone,
      salary_type = excluded.salary_type, salary_amount = excluded.salary_amount, is_active = excluded.is_active;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('employees_meta', v_n);
  end if;
  if p_data ? 'expenses' then
    insert into public.expenses select * from jsonb_populate_recordset(null::public.expenses, p_data -> 'expenses')
    on conflict (id) do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('expenses', v_n);
  end if;

  perform public.write_audit('import_backup', 'system', null, v_counts);
  return v_counts;
end;
$$;

-- Lock down: functions are granted explicitly below.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.current_user_role(), public.has_role(public.app_role[]), public.is_manager(),
  public.touch_last_login(), public.admin_update_profile(uuid, public.app_role, boolean), public.set_pin(uuid, text),
  public.adjust_stock(uuid, numeric, public.stock_reason, text), public.place_order(jsonb), public.get_order(uuid),
  public.void_order(uuid, text, boolean), public.log_pos_cancel(text, integer, numeric),
  public.advance_kitchen_status(uuid, public.kitchen_status), public.open_shift(numeric), public.shift_report(uuid),
  public.close_shift(numeric, text), public.receive_purchase_order(uuid), public.create_stock_count(text),
  public.apply_stock_count(uuid), public.mark_notifications_read(uuid[]), public.clock_in(uuid), public.clock_out(uuid),
  public.compute_payroll(date), public.import_backup(jsonb), public.unit_factor(public.unit_type, public.unit_type),
  public.menu_item_cost(uuid)
to authenticated;
