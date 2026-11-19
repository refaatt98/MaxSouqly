-- =====================================================================
-- Customer ordering at the table, without an account.
-- A guest opens the menu, picks dishes (meat type, extras, notes), enters name, phone and table,
-- and sends the order. It reaches the kitchen and the cashier marked as a customer order and
-- stays unpaid until the customer pays at the cashier.
--  * public_menu(): what the guest may see (no costs).
--  * place_customer_order(payload): validated, rate-limited, priced on the server.
--  * customer_order_status(client_ref): the guest follows their own order.
-- The owner can switch it off (restaurant_settings.customer_ordering).
-- =====================================================================

alter table public.restaurant_settings add column if not exists customer_ordering boolean not null default true;
grant select (customer_ordering) on public.restaurant_settings to authenticated;
grant update (customer_ordering) on public.restaurant_settings to authenticated;

alter table public.orders add column if not exists source text not null default 'pos';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_source_check') then
    alter table public.orders add constraint orders_source_check check (source in ('pos', 'customer'));
  end if;
end;
$$;
grant select (source) on public.orders to authenticated;
create index if not exists orders_customer_recent_idx on public.orders (created_at desc) where source = 'customer';

-- The pricing / stock / kitchen logic of place_order, without the staff checks.
-- Generated from the current place_order so both always price the same way.
-- Callable only through place_customer_order (never directly).
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.place_order(jsonb)'::regprocedure);
  patched := replace(def, 'FUNCTION public.place_order(payload jsonb)', 'FUNCTION public.place_order_guest_core(payload jsonb)');
  patched := replace(patched,
    '  v_role := public.require_role(''owner'', ''manager'', ''cashier'', ''kitchen'', ''inventory'');
  perform public.require_perm(''pos'');',
    '  v_role := ''manager'';  -- guest order: no shift, no discount (place_customer_order never sends one)');
  if position('place_order_guest_core' in patched) = 0 or position('require_perm(''pos'')' in patched) > 0 then
    raise exception 'guest core generation failed';
  end if;
  execute patched;
end;
$$;
revoke execute on function public.place_order_guest_core(jsonb) from public, anon, authenticated;

-- the menu a guest sees
create or replace function public.public_menu()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('name', s.name, 'slogan', s.slogan, 'logo_url', s.logo_url, 'currency_symbol', s.currency_symbol,
                                           'table_count', s.table_count, 'digit_style', s.digit_style, 'enabled', s.customer_ordering)
                 from public.restaurant_settings s limit 1),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_he', c.name_he, 'icon', c.icon, 'image_url', c.image_url)
                                             order by c.sort_order, c.name_ar)
                            from public.categories c where c.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'category_id', m.category_id, 'name_ar', m.name_ar, 'name_he', m.name_he,
                                                           'description', m.description, 'price', m.price, 'image_url', m.image_url, 'is_available', m.is_available)
                                        order by m.sort_order, m.name_ar)
                       from public.menu_items m
                       join public.categories c on c.id = m.category_id and c.is_active), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'menu_item_id', o.menu_item_id, 'name_ar', o.name_ar, 'name_he', o.name_he,
                                                             'price', o.price, 'kind', o.kind, 'max_qty', o.max_qty, 'is_active', o.is_active)
                                          order by o.sort_order, o.name_ar)
                         from public.menu_item_options o), '[]'::jsonb),
    'out_of_stock', coalesce((select jsonb_agg(distinct mr.option_id)
                              from public.menu_option_recipes mr
                              join public.ingredients i on i.id = mr.ingredient_id
                              where i.quantity < mr.quantity * public.unit_factor(mr.unit, i.unit)), '[]'::jsonb)
  )
$$;
revoke execute on function public.public_menu() from public;
grant execute on function public.public_menu() to anon, authenticated;

-- a guest sends an order
create or replace function public.place_customer_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.restaurant_settings;
  v_ref uuid;
  v_name text := left(trim(coalesce(payload ->> 'customer_name', '')), 60);
  v_phone text := left(trim(coalesce(payload ->> 'customer_phone', '')), 20);
  v_table integer;
  v_items jsonb := coalesce(payload -> 'items', '[]'::jsonb);
  v_clean jsonb := '[]'::jsonb;
  v_item jsonb;
  v_existing public.orders;
  v_result jsonb;
  v_id uuid;
begin
  select * into v_settings from public.restaurant_settings limit 1;
  if not coalesce(v_settings.customer_ordering, false) then
    raise exception 'CUSTOMER_ORDERING_OFF' using errcode = '42501';
  end if;

  begin
    v_ref := (payload ->> 'client_ref')::uuid;
  exception when others then
    v_ref := null;
  end;
  if v_ref is null then
    raise exception 'CLIENT_REF_REQUIRED' using errcode = '22023';
  end if;
  -- sending twice (bad connection) returns the same order
  select * into v_existing from public.orders where client_ref = v_ref;
  if found then
    if v_existing.source <> 'customer' then
      raise exception 'CLIENT_REF_REQUIRED' using errcode = '22023';
    end if;
    return jsonb_build_object('order_number', v_existing.order_number, 'total', v_existing.total, 'client_ref', v_ref);
  end if;

  if char_length(v_name) < 2 then
    raise exception 'GUEST_NAME_REQUIRED' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9+\- ]{7,20}$' then
    raise exception 'GUEST_PHONE_REQUIRED' using errcode = '22023';
  end if;
  begin
    v_table := (payload ->> 'table_no')::integer;
  exception when others then
    v_table := null;
  end;
  if v_table is null or v_table < 1 or (v_settings.table_count > 0 and v_table > v_settings.table_count) then
    raise exception 'INVALID_TABLE' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 30 then
    raise exception 'TOO_MANY_ITEMS' using errcode = '22023';
  end if;

  -- limits against abuse: a few orders per phone, and a cap for everyone together
  if (select count(*) from public.orders where source = 'customer' and created_at > now() - interval '10 minutes'
        and public.normalize_phone(customer_phone) = public.normalize_phone(v_phone)) >= 3 then
    raise exception 'GUEST_TOO_MANY_ORDERS' using errcode = '22023';
  end if;
  if (select count(*) from public.orders where source = 'customer' and created_at > now() - interval '5 minutes') >= 40 then
    raise exception 'GUEST_TOO_MANY_ORDERS' using errcode = '22023';
  end if;

  -- only what a guest may choose: dish, quantity, meat type, extras, note
  for v_item in select * from jsonb_array_elements(v_items) loop
    if coalesce((v_item ->> 'quantity')::integer, 0) not between 1 and 20 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;
    v_clean := v_clean || jsonb_build_object(
      'menu_item_id', v_item ->> 'menu_item_id',
      'quantity', (v_item ->> 'quantity')::integer,
      'variant_id', v_item ->> 'variant_id',
      'options', coalesce(v_item -> 'options', '[]'::jsonb),
      'notes', left(coalesce(v_item ->> 'notes', ''), 200)
    );
  end loop;

  v_result := public.place_order_guest_core(jsonb_build_object(
    'client_ref', v_ref,
    'type', 'dine_in',
    'table_no', v_table,
    'customer_name', v_name,
    'customer_phone', v_phone,
    'notes', left(coalesce(payload ->> 'notes', ''), 300),
    'items', v_clean,
    'payments', '[]'::jsonb,
    'pay_later', true
  ));
  v_id := (v_result ->> 'id')::uuid;
  update public.orders set source = 'customer' where id = v_id;
  insert into public.notifications (type, title, body, ref_id, target_roles)
  values ('new_order', 'طلب زبون من التطبيق #' || (v_result ->> 'order_number') || ' — طاولة ' || v_table,
          v_name || ' · ' || v_phone, v_id, '{owner,manager,cashier}');
  return jsonb_build_object('order_number', (v_result ->> 'order_number')::integer, 'total', (v_result ->> 'total')::numeric, 'client_ref', v_ref);
end;
$$;
revoke execute on function public.place_customer_order(jsonb) from public;
grant execute on function public.place_customer_order(jsonb) to anon, authenticated;

-- a guest follows their own order (the client_ref is only known to the device that sent it)
create or replace function public.customer_order_status(p_client_ref uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'status', o.status, 'total', o.total, 'payment_status', o.payment_status, 'table_no', o.table_no,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'name_he', oi.name_he_snapshot, 'qty', oi.quantity, 'options', oi.options, 'notes', oi.notes)
                                        order by oi.created_at)
                       from public.order_items oi where oi.order_id = o.id and oi.voided_at is null), '[]'::jsonb)
  )
  from public.orders o
  where o.client_ref = p_client_ref and o.source = 'customer' and o.created_at > now() - interval '1 day'
$$;
revoke execute on function public.customer_order_status(uuid) from public;
grant execute on function public.customer_order_status(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
