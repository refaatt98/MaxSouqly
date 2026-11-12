import { round2 } from '@/lib/format';
import type { MenuItem, OrderType } from '@/types/models';
import type { OrderPayload } from '@/lib/offlineQueue';

export interface CartLine {
  lineId: string;
  item: Pick<MenuItem, 'id' | 'name_ar' | 'name_he' | 'price' | 'image_url'>;
  qty: number;
  notes: string;
}

export interface CartState {
  clientRef: string;
  lines: CartLine[];
  type: OrderType;
  tableNo: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
  discountType: 'percent' | 'fixed';
  discountValue: string;
  lastAddedId: string | null;
}

export type CartAction =
  | { type: 'add'; item: CartLine['item']; qty: number }
  | { type: 'setQty'; lineId: string; qty: number }
  | { type: 'remove'; lineId: string }
  | { type: 'note'; lineId: string; notes: string }
  | { type: 'field'; field: 'tableNo' | 'customerName' | 'customerPhone' | 'customerAddress' | 'notes' | 'discountValue'; value: string }
  | { type: 'orderType'; value: OrderType }
  | { type: 'discountType'; value: 'percent' | 'fixed' }
  | { type: 'load'; state: CartState }
  | { type: 'reset' };

export function newCart(): CartState {
  return {
    clientRef: crypto.randomUUID(),
    lines: [],
    type: 'takeaway',
    tableNo: '',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    notes: '',
    discountType: 'percent',
    discountValue: '',
    lastAddedId: null,
  };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      // merge into an existing line of the same item without notes
      const existing = state.lines.find((l) => l.item.id === action.item.id && l.notes === '');
      if (existing) {
        return {
          ...state,
          lastAddedId: action.item.id,
          lines: state.lines.map((l) => (l === existing ? { ...l, qty: Math.min(999, l.qty + action.qty) } : l)),
        };
      }
      return {
        ...state,
        lastAddedId: action.item.id,
        lines: [...state.lines, { lineId: crypto.randomUUID(), item: action.item, qty: Math.min(999, action.qty), notes: '' }],
      };
    }
    case 'setQty':
      if (action.qty <= 0) return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };
      return { ...state, lines: state.lines.map((l) => (l.lineId === action.lineId ? { ...l, qty: Math.min(999, action.qty) } : l)) };
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };
    case 'note':
      return { ...state, lines: state.lines.map((l) => (l.lineId === action.lineId ? { ...l, notes: action.notes.slice(0, 200) } : l)) };
    case 'field':
      return { ...state, [action.field]: action.value };
    case 'orderType':
      return { ...state, type: action.value };
    case 'discountType':
      return { ...state, discountType: action.value, discountValue: '' };
    case 'load':
      return action.state;
    case 'reset':
      return newCart();
  }
}

export interface CartTotals {
  count: number;
  subtotal: number;
  discount: number;
  total: number;
  vat: number;
  discountPercent: number;
}

export function cartTotals(state: CartState, vatPercent: number): CartTotals {
  const subtotal = round2(state.lines.reduce((s, l) => s + Number(l.item.price) * l.qty, 0));
  const raw = Number(state.discountValue) || 0;
  let discount = state.discountType === 'percent' ? round2((subtotal * Math.min(Math.max(raw, 0), 100)) / 100) : round2(Math.max(raw, 0));
  discount = Math.min(discount, subtotal);
  const total = round2(subtotal - discount);
  return {
    count: state.lines.reduce((s, l) => s + l.qty, 0),
    subtotal,
    discount,
    total,
    vat: round2((total * vatPercent) / (100 + vatPercent)),
    discountPercent: subtotal > 0 ? (discount / subtotal) * 100 : 0,
  };
}

export type CartIssue = 'empty' | 'table' | 'delivery' | 'discount' | 'phone';

export function validateCart(state: CartState, totals: CartTotals, maxDiscountPercent: number, tableCount: number): CartIssue | null {
  if (state.lines.length === 0) return 'empty';
  if (state.type === 'dine_in') {
    const n = Number(state.tableNo);
    if (!Number.isInteger(n) || n < 1 || (tableCount > 0 && n > tableCount)) return 'table';
  }
  if (state.type === 'delivery') {
    if (state.customerName.trim().length < 2 || !/^[0-9+\- ]{7,20}$/.test(state.customerPhone.trim()) || state.customerAddress.trim().length < 4) return 'delivery';
  }
  if (state.type !== 'delivery' && state.customerPhone.trim() && !/^[0-9+\- ]{7,20}$/.test(state.customerPhone.trim())) return 'phone';
  if (totals.discountPercent > maxDiscountPercent + 0.001) return 'discount';
  return null;
}

export function buildPayload(state: CartState, totals: CartTotals, payments: OrderPayload['payments']): OrderPayload {
  return {
    client_ref: state.clientRef,
    type: state.type,
    table_no: state.type === 'dine_in' ? Number(state.tableNo) : null,
    customer_name: state.customerName.trim(),
    customer_phone: state.customerPhone.trim(),
    customer_address: state.type === 'delivery' ? state.customerAddress.trim() : '',
    notes: state.notes.trim(),
    discount: totals.discount > 0 ? { type: state.discountType, value: Number(state.discountValue) } : null,
    items: state.lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty, notes: l.notes.trim() })),
    payments,
  };
}

// ---------------------------------------------------------------- held orders
const HELD_KEY = 'max.pos.held';

export interface HeldOrder {
  id: string;
  created_at: string;
  cart: CartState;
}

export function loadHeld(): HeldOrder[] {
  try {
    const raw = localStorage.getItem(HELD_KEY);
    return raw ? (JSON.parse(raw) as HeldOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveHeld(list: HeldOrder[]): void {
  try {
    localStorage.setItem(HELD_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
