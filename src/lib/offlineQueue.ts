import { idbClear, idbCount, idbDelete, idbGet, idbGetAll, idbPut, STORE_KV, STORE_ORDERS } from './idb';

// Payload accepted by the place_order RPC.
export interface OrderPayload {
  client_ref: string;
  type: 'dine_in' | 'takeaway' | 'delivery';
  table_no?: number | null;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  notes?: string;
  discount?: { type: 'percent' | 'fixed'; value: number } | null;
  items: { menu_item_id: string; quantity: number; notes?: string; options?: string[] }[];
  payments: { method: 'cash' | 'card'; amount: number; tendered?: number | null }[];
  offline_created_at?: string;
  /** send now, collect payment later (payments may be partial or empty) */
  pay_later?: boolean;
}

export interface QueuedOrder {
  client_ref: string;
  payload: OrderPayload;
  temp_number: string;
  created_at: string;
  attempts: number;
  last_error?: string;
}

export const QUEUE_EVENT = 'max:queue-changed';

function notify() {
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await idbPut(STORE_KV, { value, saved_at: new Date().toISOString() }, key);
  } catch {
    /* storage unavailable (private mode) — offline cache is best effort */
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const row = await idbGet<{ value: T }>(STORE_KV, key);
    return row?.value;
  } catch {
    return undefined;
  }
}

async function nextTempNumber(): Promise<string> {
  const n = ((await cacheGet<number>('temp_counter')) ?? 0) + 1;
  await cacheSet('temp_counter', n);
  return `T-${String(n).padStart(3, '0')}`;
}

export async function enqueueOrder(payload: OrderPayload): Promise<QueuedOrder> {
  const queued: QueuedOrder = {
    client_ref: payload.client_ref,
    payload: { ...payload, offline_created_at: payload.offline_created_at ?? new Date().toISOString() },
    temp_number: await nextTempNumber(),
    created_at: new Date().toISOString(),
    attempts: 0,
  };
  await idbPut(STORE_ORDERS, queued);
  notify();
  return queued;
}

export async function listQueued(): Promise<QueuedOrder[]> {
  try {
    const all = await idbGetAll<QueuedOrder>(STORE_ORDERS);
    return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function countQueued(): Promise<number> {
  try {
    return await idbCount(STORE_ORDERS);
  } catch {
    return 0;
  }
}

/** Temp number → real order number, remembered after a successful sync. */
export async function syncedNumbers(): Promise<Record<string, number>> {
  return (await cacheGet<Record<string, number>>('synced_numbers')) ?? {};
}

export interface SyncResult {
  synced: number;
  failed: number;
  lastError?: unknown;
}

let syncing: Promise<SyncResult> | null = null;

/**
 * Sends queued orders one by one (oldest first). The client_ref is the idempotency key,
 * so a retry after a lost response never creates a duplicate order.
 */
export function syncQueue(placeOrder: (payload: OrderPayload) => Promise<{ order_number: number }>): Promise<SyncResult> {
  if (syncing) return syncing;
  syncing = (async () => {
    const result: SyncResult = { synced: 0, failed: 0 };
    const mapping = await syncedNumbers();
    for (const q of await listQueued()) {
      try {
        const order = await placeOrder(q.payload);
        mapping[q.temp_number] = order.order_number;
        await idbDelete(STORE_ORDERS, q.client_ref);
        result.synced += 1;
      } catch (err) {
        result.failed += 1;
        result.lastError = err;
        await idbPut(STORE_ORDERS, { ...q, attempts: q.attempts + 1, last_error: String((err as { message?: string })?.message ?? err) });
        // network problem → stop and retry later; validation problem → keep going
        if (err instanceof TypeError) break;
      }
    }
    await cacheSet('synced_numbers', mapping);
    notify();
    return result;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function clearOfflineData(): Promise<void> {
  try {
    await idbClear(STORE_KV);
  } finally {
    notify();
  }
}
