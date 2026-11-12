import { supabase } from '@/lib/supabase';
import type { AppRole, Attendance, Employee, Profile } from '@/types/models';

export type EmployeeRow = Employee & { profile: Pick<Profile, 'id' | 'role' | 'last_login_at' | 'is_active' | 'avatar_url'> | null };

export async function fetchEmployees(): Promise<EmployeeRow[]> {
  const { data, error } = await supabase
    .from('employees_meta')
    .select('*, profile:profiles!employees_meta_profile_id_fkey(id, role, last_login_at, is_active, avatar_url)')
    .order('is_active', { ascending: false })
    .order('full_name');
  if (error) throw error;
  return data as unknown as EmployeeRow[];
}

export async function fetchOpenAttendance(): Promise<Attendance[]> {
  const { data, error } = await supabase.from('attendance').select('*').is('clock_out', null);
  if (error) throw error;
  return data;
}

/** Owner creates a login account (any role) — runs as the owner-only SQL function admin_create_user. */
export async function createEmployeeUser(input: { email: string; password: string; full_name: string; role: AppRole; phone?: string; pin?: string; employee_id?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_user', {
    p_email: input.email.trim(),
    p_password: input.password,
    p_full_name: input.full_name.trim(),
    p_role: input.role,
    p_phone: input.phone?.trim() ?? '',
    p_pin: input.pin ?? '',
    p_employee_id: input.employee_id,
  });
  if (error) throw error;
  return data;
}

export async function resetUserPassword(userId: string, password: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_password', { p_user_id: userId, p_password: password });
  if (error) throw error;
}

export function hoursBetween(from: string, to: string | null, now = Date.now()): number {
  return Math.max(0, ((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 3_600_000);
}
