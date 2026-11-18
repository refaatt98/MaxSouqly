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
