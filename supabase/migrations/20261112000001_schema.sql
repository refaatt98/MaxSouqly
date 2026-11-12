-- =====================================================================
-- MAX Restaurant Management System — core schema
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum ('owner', 'manager', 'cashier', 'kitchen', 'inventory');
create type public.order_type as enum ('dine_in', 'takeaway', 'delivery');
create type public.order_status as enum ('new', 'preparing', 'ready', 'served', 'cancelled', 'refunded');
create type public.kitchen_status as enum ('new', 'preparing', 'ready', 'served');
create type public.payment_method as enum ('cash', 'card');
create type public.discount_type as enum ('percent', 'fixed');
create type public.stock_reason as enum ('sale', 'purchase', 'adjustment', 'waste', 'void');
create type public.unit_type as enum ('kg', 'g', 'l', 'ml', 'piece', 'carton');
create type public.po_status as enum ('draft', 'sent', 'received', 'cancelled');
create type public.stock_count_status as enum ('draft', 'applied');
create type public.salary_type as enum ('monthly', 'hourly');
create type public.payroll_status as enum ('draft', 'paid');
create type public.notification_type as enum ('low_stock', 'new_order', 'void', 'system');
create type public.expense_category as enum ('rent', 'utilities', 'salaries', 'supplies', 'maintenance', 'marketing', 'other');

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role public.app_role not null default 'cashier',
  pin_hash text,
  avatar_url text,
  language text not null default 'ar' check (language in ('ar', 'he')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  name text not null default 'MAX',
  slogan text not null default 'Good Food Good Mood',
  logo_url text,
  phone text not null default '',
  address text not null default '',
  vat_percent numeric(5, 2) not null default 17 check (vat_percent between 0 and 100),
  receipt_header text not null default '',
  receipt_footer text not null default 'Good Food Good Mood',
  offline_mode boolean not null default true,
  auto_sync boolean not null default true,
  order_notifications boolean not null default true,
  kitchen_warn_minutes integer not null default 8 check (kitchen_warn_minutes between 1 and 240),
  kitchen_late_minutes integer not null default 15 check (kitchen_late_minutes between 1 and 240),
  table_count integer not null default 20 check (table_count between 0 and 500),
  seating_capacity integer not null default 60 check (seating_capacity between 0 and 5000),
  currency_symbol text not null default '₪' check (char_length(currency_symbol) between 1 and 5),
  digit_style text not null default 'latin' check (digit_style in ('latin', 'arabic')),
  max_discount_cashier_percent numeric(5, 2) not null default 10 check (max_discount_cashier_percent between 0 and 100),
  max_discount_manager_percent numeric(5, 2) not null default 100 check (max_discount_manager_percent between 0 and 100),
  timezone text not null default 'Asia/Jerusalem',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kitchen_late_minutes > kitchen_warn_minutes)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (char_length(name_ar) between 1 and 60),
  name_he text not null default '' check (char_length(name_he) <= 60),
  icon text not null default 'utensils',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  name_ar text not null check (char_length(name_ar) between 1 and 80),
  name_he text not null default '' check (char_length(name_he) <= 80),
  description text not null default '' check (char_length(description) <= 300),
  price numeric(10, 2) not null check (price >= 0),
  cost_cache numeric(10, 2) not null default 0,
  image_url text,
  barcode text unique,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_category_idx on public.menu_items (category_id);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (char_length(name_ar) between 1 and 80),
  name_he text not null default '',
  unit public.unit_type not null,
  quantity numeric(12, 3) not null default 0,
  min_quantity numeric(12, 3) not null default 0 check (min_quantity >= 0),
  cost_per_unit numeric(12, 4) not null default 0 check (cost_per_unit >= 0),
  image_url text,
  supplier_id uuid references public.suppliers (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 4) not null check (quantity > 0),
  unit public.unit_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_item_id, ingredient_id)
);
create index recipe_items_ingredient_idx on public.recipe_items (ingredient_id);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number integer generated by default as identity (start with 101) unique,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  status public.po_status not null default 'draft',
  notes text not null default '',
  expected_date date,
  total numeric(12, 2) not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz,
  received_at timestamptz,
  received_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_cost numeric(12, 4) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index poi_po_idx on public.purchase_order_items (purchase_order_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  change numeric(12, 3) not null,
  quantity_after numeric(12, 3) not null,
  reason public.stock_reason not null,
  ref_id uuid,
  note text not null default '',
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stock_movements_ing_idx on public.stock_movements (ingredient_id, created_at desc);
create index stock_movements_created_idx on public.stock_movements (created_at desc);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  status public.stock_count_status not null default 'draft',
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  applied_at timestamptz,
  applied_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.stock_counts (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  expected_quantity numeric(12, 3) not null default 0,
  counted_quantity numeric(12, 3),
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stock_count_id, ingredient_id)
);

create table public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles (id) on delete restrict,
  opening_float numeric(12, 2) not null default 0 check (opening_float >= 0),
  cash_sales numeric(12, 2) not null default 0,
  card_sales numeric(12, 2) not null default 0,
  expected_cash numeric(12, 2),
  counted_cash numeric(12, 2),
  notes text not null default '',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cash_shifts_one_open_idx on public.cash_shifts (cashier_id) where closed_at is null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number integer generated by default as identity (start with 1001) unique,
  client_ref uuid unique,
  type public.order_type not null,
  table_no integer check (table_no is null or table_no between 1 and 500),
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_address text not null default '',
  status public.order_status not null default 'new',
  subtotal numeric(12, 2) not null default 0,
  discount_type public.discount_type,
  discount_value numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  vat_amount numeric(12, 2) not null default 0,
  cost_total numeric(12, 2) not null default 0,
  cashier_id uuid references public.profiles (id) on delete set null,
  shift_id uuid references public.cash_shifts (id) on delete set null,
  notes text not null default '',
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_status_idx on public.orders (status) where status in ('new', 'preparing', 'ready');
create index orders_cashier_idx on public.orders (cashier_id, created_at desc);
create index orders_shift_idx on public.orders (shift_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  name_snapshot text not null,
  name_he_snapshot text not null default '',
  unit_price_snapshot numeric(10, 2) not null,
  unit_cost_snapshot numeric(10, 2) not null default 0,
  quantity integer not null check (quantity between 1 and 999),
  line_total numeric(12, 2) not null,
  notes text not null default '' check (char_length(notes) <= 200),
  kitchen_status public.kitchen_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_menu_idx on public.order_items (menu_item_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  method public.payment_method not null,
  amount numeric(12, 2) not null,
  tendered numeric(12, 2),
  change_given numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);

create table public.employees_meta (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null check (char_length(full_name) between 1 and 120),
  position text not null default '',
  phone text not null default '',
  avatar_url text,
  salary_type public.salary_type not null default 'monthly',
  salary_amount numeric(12, 2) not null default 0 check (salary_amount >= 0),
  hire_date date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees_meta (id) on delete cascade,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index work_shifts_date_idx on public.work_shifts (shift_date);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees_meta (id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in)
);
create index attendance_emp_idx on public.attendance (employee_id, clock_in desc);
create unique index attendance_one_open_idx on public.attendance (employee_id) where clock_out is null;

create table public.payroll (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees_meta (id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  hours_worked numeric(8, 2) not null default 0,
  base_amount numeric(12, 2) not null default 0,
  bonuses numeric(12, 2) not null default 0 check (bonuses >= 0),
  advances numeric(12, 2) not null default 0 check (advances >= 0),
  deductions numeric(12, 2) not null default 0 check (deductions >= 0),
  net_amount numeric(12, 2) not null default 0,
  status public.payroll_status not null default 'draft',
  paid_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, period_month)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category public.expense_category not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  receipt_url text,
  expense_date date not null default current_date,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (expense_date);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type public.notification_type not null,
  title text not null,
  body text not null default '',
  ref_id uuid,
  target_roles public.app_role[] not null default '{owner,manager}',
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_created_idx on public.notifications (created_at desc);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- PIN brute-force protection (written only by the pin-login Edge Function / service role)
create table public.pin_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  success boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pin_attempts_ip_idx on public.pin_attempts (ip, created_at desc);

-- updated_at triggers on every table
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'restaurant_settings', 'categories', 'menu_items', 'suppliers', 'ingredients',
    'recipe_items', 'purchase_orders', 'purchase_order_items', 'stock_movements', 'stock_counts',
    'stock_count_items', 'cash_shifts', 'orders', 'order_items', 'payments', 'employees_meta',
    'work_shifts', 'attendance', 'payroll', 'expenses', 'notifications', 'audit_log', 'pin_attempts'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end;
$$;

insert into public.restaurant_settings (singleton) values (true);
