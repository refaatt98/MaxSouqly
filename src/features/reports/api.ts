import { supabase } from '@/lib/supabase';
import { fromJson, type ExpenseCategory, type OrderType, type PaymentMethod, type SalaryType } from '@/types/models';

export interface SalesReport {
  total: number;
  orders: number;
  avg_ticket: number;
  discounts: number;
  vat: number;
  voided: number;
  prev_total: number;
  by_day: { date: string; total: number; orders: number }[];
  by_payment: { method: PaymentMethod; amount: number; count: number }[];
  by_type: { type: OrderType; total: number; orders: number }[];
}

export interface ProfitReport {
  revenue: number;
  cogs: number;
  expenses: number;
  gross: number;
  net: number;
  prev_net: number;
  by_day: { date: string; revenue: number; cogs: number; expenses: number; net: number }[];
  expenses_by_category: { category: ExpenseCategory; amount: number }[];
}

export interface TopItem {
  menu_item_id: string;
  name: string;
  name_he: string;
  qty: number;
  revenue: number;
  cost: number;
  image_url: string | null;
}

export interface HourCell {
  dow: number;
  hour: number;
  orders: number;
  total: number;
}

export interface CashierRow {
  cashier_id: string | null;
  name: string | null;
  avatar_url: string | null;
  orders: number;
  total: number;
  avg_ticket: number;
  discounts: number;
  voids: number;
}

export interface EmployeeReportRow {
  id: string;
  name: string;
  position: string;
  avatar_url: string | null;
  salary_type: SalaryType;
  salary_amount: number;
  hours: number;
  days: number;
  scheduled_shifts: number;
}

async function rpc<T>(fn: 'report_sales' | 'report_profit' | 'report_hourly' | 'report_cashiers' | 'report_employees', from: string, to: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { p_from: from, p_to: to });
  if (error) throw error;
  return fromJson<T>(data);
}

export const fetchSales = (from: string, to: string) => rpc<SalesReport>('report_sales', from, to);
export const fetchProfit = (from: string, to: string) => rpc<ProfitReport>('report_profit', from, to);
export const fetchHourly = (from: string, to: string) => rpc<HourCell[]>('report_hourly', from, to);
export const fetchCashiers = (from: string, to: string) => rpc<CashierRow[]>('report_cashiers', from, to);
export const fetchEmployeeReport = (from: string, to: string) => rpc<EmployeeReportRow[]>('report_employees', from, to);

export async function fetchTopItems(from: string, to: string, limit = 10): Promise<TopItem[]> {
  const { data, error } = await supabase.rpc('report_top_items', { p_from: from, p_to: to, p_limit: limit });
  if (error) throw error;
  return fromJson<TopItem[]>(data);
}
