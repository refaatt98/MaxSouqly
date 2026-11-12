import { supabase } from '@/lib/supabase';
import { fromJson, type OrderFull } from '@/types/models';

export type EditResult = OrderFull & { money_delta?: number };

/** Cancel `quantity` units of an order line (stock goes back, money difference is recorded). */
export async function voidOrderItem(itemId: string, quantity: number, reason: string): Promise<EditResult> {
  const { data, error } = await supabase.rpc('void_order_item', { p_item_id: itemId, p_quantity: quantity, p_reason: reason });
  if (error) throw error;
  return fromJson<EditResult>(data);
}

/** Replace a line with another menu item. */
export async function replaceOrderItem(itemId: string, menuItemId: string, quantity: number, notes: string, reason: string): Promise<EditResult> {
  const { data, error } = await supabase.rpc('replace_order_item', { p_item_id: itemId, p_menu_item_id: menuItemId, p_quantity: quantity, p_notes: notes, p_reason: reason });
  if (error) throw error;
  return fromJson<EditResult>(data);
}

export async function cancelOrder(orderId: string, reason: string, refund = false): Promise<OrderFull> {
  const { data, error } = await supabase.rpc('void_order', { p_order_id: orderId, p_reason: reason, p_refund: refund });
  if (error) throw error;
  return fromJson<OrderFull>(data);
}
