-- =====================================================================
-- Security hardening (from the Supabase security advisor)
-- =====================================================================
alter function public.payroll_net() set search_path = public;
alter function public.check_recipe_unit() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.unit_factor(public.unit_type, public.unit_type) set search_path = public;
alter function public.menu_item_cost(uuid) set search_path = public;
alter function public.local_date(timestamptz) set search_path = public;
alter function public.range_start(date) set search_path = public;
alter function public.range_end(date) set search_path = public;
alter function public.check_range(date, date) set search_path = public;

-- Trigger functions and internal helpers are never called directly by clients.
revoke execute on function
  public.handle_new_user(), public.log_initial_stock(), public.payroll_paid_expense(),
  public.refresh_cost_from_ingredient(), public.refresh_cost_from_recipe(), public.refresh_po_total(),
  public.require_role(public.app_role[])
from public, anon, authenticated;
