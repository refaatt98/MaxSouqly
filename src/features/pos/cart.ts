import { round2 } from '@/lib/format';
import type { MenuItem, OrderType } from '@/types/models';
import type { OrderPayload } from '@/lib/offlineQueue';

export interface CartOption {
  id: string;
  name_ar: string;
  name_he: string;
  price: number;
}

export interface CartLine {
  lineId: string;
  item: Pick<MenuItem, 'id' | 'name_ar' | 'name_he' | 'price' | 'image_url'>;
  qty: number;
  notes: string;
  /** chosen extras (cheese, sauce…); older saved carts may lack this */
  options?: CartOption[];
}

/** Price of one unit of a line: the item plus its extras. */
export function unitPrice(l: CartLine): number {
  return round2(Number(l.item.price) + (l.options ?? []).reduce((s, o) => s + Number(o.price), 0));
}

const optionsKey = (opts: CartOption[] | undefined) => (opts ?? []).map((o) => o.id).sort().join(',');

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
  /** staff meal: the employee eating it (no payment, not counted as a sale) */
  staffMeal?: boolean;
  staffId?: string;
}

export type CartAction =
  | { type: 'add'; item: CartLine['item']; qty: number; options?: CartOption[] }
  | { type: 'setQty'; lineId: string; qty: number }
  | { type: 'remove'; lineId: string }
  | { type: 'note'; lineId: string; notes: string }
  | { type: 'field'; field: 'tableNo' | 'customerName' | 'customerPhone' | 'customerAddress' | 'notes' | 'discountValue'; value: string }
  | { type: 'orderType'; value: OrderType }
  | { type: 'staffMeal'; on: boolean }
  | { type: 'staff'; id: string }
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
      // tapping the same item again raises its quantity (same extras, no notes)
      const key = optionsKey(action.options);
      const existing = state.lines.find((l) => l.item.id === action.item.id && l.notes === '' && optionsKey(l.options) === key);
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
        lines: [...state.lines, { lineId: crypto.randomUUID(), item: action.item, qty: Math.min(999, action.qty), notes: '', options: action.options ?? [] }],
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
      return { ...state, type: action.value, staffMeal: false, staffId: '' };
    case 'staffMeal':
      return { ...state, staffMeal: action.on, staffId: action.on ? (state.staffId ?? '') : '', discountValue: '' };
    case 'staff':
      return { ...state, staffId: action.id };
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
  const subtotal = round2(state.lines.reduce((s, l) => s + unitPrice(l) * l.qty, 0));
  if (state.staffMeal) {
    // the meal's menu value is shown, but nothing is charged
    return { count: state.lines.reduce((s, l) => s + l.qty, 0), subtotal, discount: 0, total: 0, vat: 0, discountPercent: 0 };
  }
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

export type CartIssue = 'empty' | 'table' | 'delivery' | 'discount' | 'phone' | 'staff';

export function validateCart(state: CartState, totals: CartTotals, maxDiscountPercent: number, tableCount: number): CartIssue | null {
  if (state.lines.length === 0) return 'empty';
  if (state.staffMeal) return state.staffId ? null : 'staff';
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

export function buildPayload(state: CartState, totals: CartTotals, payments: OrderPayload['payments'], payLater = false): OrderPayload {
  if (state.staffMeal && state.staffId) {
    return {
      client_ref: state.clientRef,
      type: 'takeaway',
      table_no: null,
      notes: state.notes.trim(),
      discount: null,
      items: state.lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty, notes: l.notes.trim(), options: (l.options ?? []).map((o) => o.id) })),
      payments: [],
      pay_later: true,
      staff_employee_id: state.staffId,
    };
  }
  return {
    client_ref: state.clientRef,
    type: state.type,
    table_no: state.type === 'dine_in' ? Number(state.tableNo) : null,
    customer_name: state.customerName.trim(),
    customer_phone: state.customerPhone.trim(),
    customer_address: state.customerAddress.trim(),
    notes: state.notes.trim(),
    discount: totals.discount > 0 ? { type: state.discountType, value: Number(state.discountValue) } : null,
    items: state.lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty, notes: l.notes.trim(), options: (l.options ?? []).map((o) => o.id) })),
    payments,
    ...(payLater ? { pay_later: true } : {}),
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
