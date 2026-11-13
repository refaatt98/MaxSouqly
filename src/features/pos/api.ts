import { supabase } from '@/lib/supabase';
import { MENU_ITEM_COLS } from '@/lib/columns';
import { cacheGet, cacheSet, type OrderPayload } from '@/lib/offlineQueue';
import { fromJson, type CashShift, type Category, type MenuItem, type MenuItemOption, type OrderFull, type Printer, type ShiftReport } from '@/types/models';

export interface Catalog {
  categories: Category[];
  items: MenuItem[];
  /** active extras, by menu item */
  options: MenuItemOption[];
  printers: Printer[];
  fromCache: boolean;
}

const CATALOG_KEY = 'catalog';

/** Menu + categories, cached in IndexedDB so the POS keeps working offline. */
export async function fetchCatalog(): Promise<Catalog> {
  try {
    const [cats, items, opts, printers] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('sort_order').order('name_ar'),
      supabase.from('menu_items').select(MENU_ITEM_COLS).order('sort_order').order('name_ar'),
      supabase.from('menu_item_options').select('*').eq('is_active', true).order('sort_order').order('name_ar'),
      supabase.from('printers').select('*').eq('is_active', true).order('sort_order').order('name'),
    ]);
    if (cats.error) throw cats.error;
    if (items.error) throw items.error;
    if (opts.error) throw opts.error;
    const catalog = { categories: cats.data, items: items.data, options: opts.data, printers: printers.data ?? [] };
    void cacheSet(CATALOG_KEY, catalog);
    return { ...catalog, fromCache: false };
  } catch (err) {
    const cached = await cacheGet<Omit<Catalog, 'fromCache'>>(CATALOG_KEY);
    if (cached) return { ...cached, options: cached.options ?? [], printers: cached.printers ?? [], fromCache: true };
    throw err;
  }
}

export async function placeOrder(payload: OrderPayload): Promise<OrderFull> {
  const { data, error } = await supabase.rpc('place_order', { payload: fromJson(payload as never) });
  if (error) throw error;
  return fromJson<OrderFull>(data);
}

export async function getOrder(id: string): Promise<OrderFull> {
  const { data, error } = await supabase.rpc('get_order', { p_order_id: id });
  if (error) throw error;
  return fromJson<OrderFull>(data);
}

export async function fetchOpenShift(userId: string): Promise<CashShift | null> {
  const { data, error } = await supabase.from('cash_shifts').select('*').eq('cashier_id', userId).is('closed_at', null).maybeSingle();
  if (error) throw error;
  return data;
}

export const SHIFT_EVENT = 'max:shift-changed';

export async function openShift(openingFloat: number): Promise<CashShift> {
  const { data, error } = await supabase.rpc('open_shift', { p_opening_float: openingFloat });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(SHIFT_EVENT));
  return data;
}

export async function closeShift(countedCash: number, notes: string): Promise<ShiftReport> {
  const { data, error } = await supabase.rpc('close_shift', { p_counted_cash: countedCash, p_notes: notes });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(SHIFT_EVENT));
  return fromJson<ShiftReport>(data);
}

export async function shiftReport(shiftId: string): Promise<ShiftReport> {
  const { data, error } = await supabase.rpc('shift_report', { p_shift_id: shiftId });
  if (error) throw error;
  return fromJson<ShiftReport>(data);
}

export async function logCartCancel(reason: string, items: number, total: number): Promise<void> {
  const { error } = await supabase.rpc('log_pos_cancel', { p_reason: reason, p_items: items, p_total: total });
  if (error) throw error;
}

/** Collect payment for an order that was sent before being paid. */
export async function addPayment(orderId: string, payments: OrderPayload['payments']): Promise<OrderFull> {
  const { data, error } = await supabase.rpc('add_payment', { p_order_id: orderId, p_payments: fromJson(payments as never) });
  if (error) throw error;
  return fromJson<OrderFull>(data);
}

export interface CustomerMatch {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  orders_count: number;
  last_order_at: string | null;
  favorites: string[];
}

/** Lookup while taking an order — returns only what serving the customer needs. */
export async function findCustomers(query: string): Promise<CustomerMatch[]> {
  const { data, error } = await supabase.rpc('find_customers', { p_query: query });
  if (error) throw error;
  return fromJson<CustomerMatch[]>(data);
}

export interface StaffMember {
  id: string;
  full_name: string;
  avatar_url: string | null;
  position: string;
  open_since: string | null;
  /** paid by the day: present or absent */
  daily?: boolean;
  absent_today?: boolean;
  present_today?: boolean;
}

export async function fetchStaffBoard(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc('staff_board');
  if (error) throw error;
  return fromJson<StaffMember[]>(data);
}

export async function recordAdvance(employeeId: string, amount: number, note: string): Promise<void> {
  const { error } = await supabase.rpc('record_advance', { p_employee_id: employeeId, p_amount: amount, p_note: note });
  if (error) throw error;
}
