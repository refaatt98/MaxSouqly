import { supabase } from '@/lib/supabase';
import { cacheGet, cacheSet, type OrderPayload } from '@/lib/offlineQueue';
import { fromJson, type CashShift, type Category, type MenuItem, type OrderFull, type ShiftReport } from '@/types/models';

export interface Catalog {
  categories: Category[];
  items: MenuItem[];
  fromCache: boolean;
}

const CATALOG_KEY = 'catalog';

/** Menu + categories, cached in IndexedDB so the POS keeps working offline. */
export async function fetchCatalog(): Promise<Catalog> {
  try {
    const [cats, items] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('sort_order').order('name_ar'),
      supabase.from('menu_items').select('*').order('sort_order').order('name_ar'),
    ]);
    if (cats.error) throw cats.error;
    if (items.error) throw items.error;
    const catalog = { categories: cats.data, items: items.data };
    void cacheSet(CATALOG_KEY, catalog);
    return { ...catalog, fromCache: false };
  } catch (err) {
    const cached = await cacheGet<Omit<Catalog, 'fromCache'>>(CATALOG_KEY);
    if (cached) return { ...cached, fromCache: true };
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

export async function openShift(openingFloat: number): Promise<CashShift> {
  const { data, error } = await supabase.rpc('open_shift', { p_opening_float: openingFloat });
  if (error) throw error;
  return data;
}

export async function closeShift(countedCash: number, notes: string): Promise<ShiftReport> {
  const { data, error } = await supabase.rpc('close_shift', { p_counted_cash: countedCash, p_notes: notes });
  if (error) throw error;
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
