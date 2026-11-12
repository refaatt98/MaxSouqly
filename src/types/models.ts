import type { Enums, Json, Tables } from './database';

export type AppRole = Enums<'app_role'>;
export type OrderType = Enums<'order_type'>;
export type OrderStatus = Enums<'order_status'>;
export type KitchenStatus = Enums<'kitchen_status'>;
export type PaymentMethod = Enums<'payment_method'>;
export type UnitType = Enums<'unit_type'>;
export type StockReason = Enums<'stock_reason'>;
export type PoStatus = Enums<'po_status'>;
export type ExpenseCategory = Enums<'expense_category'>;
export type NotificationType = Enums<'notification_type'>;

export type Profile = Omit<Tables<'profiles'>, 'pin_hash'>;
export type Settings = Tables<'restaurant_settings'>;
export type Category = Tables<'categories'>;
export type MenuItem = Tables<'menu_items'>;
export type Ingredient = Tables<'ingredients'>;
export type RecipeItem = Tables<'recipe_items'>;
export type Supplier = Tables<'suppliers'>;
export type PurchaseOrder = Tables<'purchase_orders'>;
export type PurchaseOrderItem = Tables<'purchase_order_items'>;
export type StockMovement = Tables<'stock_movements'>;
export type StockCount = Tables<'stock_counts'>;
export type StockCountItem = Tables<'stock_count_items'>;
export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type Payment = Tables<'payments'>;
export type CashShift = Tables<'cash_shifts'>;
export type Employee = Tables<'employees_meta'>;
export type WorkShift = Tables<'work_shifts'>;
export type Attendance = Tables<'attendance'>;
export type Payroll = Tables<'payroll'>;
export type Expense = Tables<'expenses'>;
export type AppNotification = Tables<'notifications'>;

/** Shape returned by place_order / get_order / void_order. */
export type OrderFull = Order & {
  cashier_name: string | null;
  items: OrderItem[];
  payments: Payment[];
};

export interface ShiftReport {
  shift: CashShift;
  cashier_name: string | null;
  cash_sales: number;
  card_sales: number;
  expected_cash: number;
  orders_count: number;
  voided_count: number;
  voided_total: number;
  discount_total: number;
  gross_total: number;
  by_type: { type: OrderType; orders: number; total: number }[];
}

/** Narrow a JSON value returned by an RPC to the documented shape. */
export function fromJson<T>(value: Json): T {
  return value as unknown as T;
}

export const ROLES: AppRole[] = ['owner', 'manager', 'cashier', 'kitchen', 'inventory'];
export const UNITS: UnitType[] = ['kg', 'g', 'l', 'ml', 'piece', 'carton'];
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['rent', 'utilities', 'salaries', 'supplies', 'maintenance', 'marketing', 'other'];
