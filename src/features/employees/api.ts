import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
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

export class CreateUserError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Calls the create-employee-user Edge Function (owner only; uses the service role server side). */
export async function createEmployeeUser(input: { email: string; password: string; full_name: string; role: AppRole; pin?: string; employee_id?: string }): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CreateUserError('NOT_AUTHENTICATED');
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/create-employee-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new TypeError('Failed to fetch');
  }
  const body = (await res.json().catch(() => ({}))) as { user_id?: string; error?: string };
  if (!res.ok || !body.user_id) throw new CreateUserError(body.error ?? 'CREATE_FAILED');
  return body.user_id;
}

export function hoursBetween(from: string, to: string | null, now = Date.now()): number {
  return Math.max(0, ((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 3_600_000);
}
