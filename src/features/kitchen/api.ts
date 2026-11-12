import { supabase } from '@/lib/supabase';
import type { KitchenStatus, Order, OrderItem } from '@/types/models';

export type KitchenOrder = Pick<Order, 'id' | 'order_number' | 'type' | 'table_no' | 'status' | 'created_at' | 'preparing_at' | 'ready_at' | 'notes' | 'customer_name'> & {
  items: Pick<OrderItem, 'id' | 'name_snapshot' | 'name_he_snapshot' | 'quantity' | 'notes'>[];
};

const SELECT = 'id, order_number, type, table_no, status, created_at, preparing_at, ready_at, notes, customer_name, items:order_items(id, name_snapshot, name_he_snapshot, quantity, notes)';

export async function fetchActiveOrders(): Promise<KitchenOrder[]> {
  const { data, error } = await supabase.from('orders').select(SELECT).in('status', ['new', 'preparing', 'ready']).order('created_at');
  if (error) throw error;
  return data as KitchenOrder[];
}

export async function fetchKitchenOrder(id: string): Promise<KitchenOrder | null> {
  const { data, error } = await supabase.from('orders').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as KitchenOrder | null;
}

export async function advanceStatus(orderId: string, status: KitchenStatus): Promise<void> {
  const { error } = await supabase.rpc('advance_kitchen_status', { p_order_id: orderId, p_status: status });
  if (error) throw error;
}

export const KITCHEN_FLOW: KitchenStatus[] = ['new', 'preparing', 'ready', 'served'];

export function nextStatus(s: KitchenStatus): KitchenStatus | null {
  const i = KITCHEN_FLOW.indexOf(s);
  return i >= 0 && i < KITCHEN_FLOW.length - 1 ? KITCHEN_FLOW[i + 1] : null;
}

export function prevStatus(s: KitchenStatus): KitchenStatus | null {
  const i = KITCHEN_FLOW.indexOf(s);
  return i > 0 ? KITCHEN_FLOW[i - 1] : null;
}
