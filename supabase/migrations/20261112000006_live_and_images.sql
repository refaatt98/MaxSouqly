-- =====================================================================
-- Category images + realtime on every table the UI shows,
-- so all screens update live without refreshing.
-- =====================================================================

alter table public.categories add column if not exists image_url text;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'orders', 'order_items', 'notifications', 'ingredients', 'restaurant_settings', 'menu_items',
    'categories', 'recipe_items', 'suppliers', 'purchase_orders', 'purchase_order_items',
    'stock_movements', 'stock_counts', 'stock_count_items', 'payments', 'cash_shifts',
    'employees_meta', 'work_shifts', 'attendance', 'payroll', 'expenses'
  ] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
