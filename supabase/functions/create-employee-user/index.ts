// create-employee-user: the owner creates a login account for an employee.
// Uses the service role server side only; the caller must be an active owner.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, env, error, json } from '../_shared/http.ts';

const ROLES = ['owner', 'manager', 'cashier', 'kitchen', 'inventory'] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABEL_AR: Record<Role, string> = { owner: 'المالك', manager: 'مدير', cashier: 'كاشير', kitchen: 'مطبخ', inventory: 'مسؤول مخزون' };

interface Body {
  email: string;
  password: string;
  full_name: string;
  role: Role;
  pin?: string;
  employee_id?: string;
}

function parse(raw: unknown): Body | string {
  if (!raw || typeof raw !== 'object') return 'INVALID_BODY';
  const b = raw as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
  const role = b.role as Role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'INVALID_EMAIL';
  if (password.length < 8) return 'WEAK_PASSWORD';
  if (fullName.length < 2 || fullName.length > 120) return 'INVALID_NAME';
  if (!ROLES.includes(role)) return 'INVALID_ROLE';
  const pin = typeof b.pin === 'string' && b.pin !== '' ? b.pin : undefined;
  if (pin !== undefined && !/^[0-9]{4,6}$/.test(pin)) return 'INVALID_PIN';
  const employeeId = typeof b.employee_id === 'string' && b.employee_id !== '' ? b.employee_id : undefined;
  return { email, password, full_name: fullName, role, pin, employee_id: employeeId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== 'POST') return error(req, 'METHOD_NOT_ALLOWED', 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return error(req, 'NOT_AUTHENTICATED', 401);

  const url = env('SUPABASE_URL');
  const caller = createClient(url, env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: me } = await caller.auth.getUser();
  if (!me.user) return error(req, 'NOT_AUTHENTICATED', 401);

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: profile } = await admin.from('profiles').select('role, is_active').eq('id', me.user.id).single();
  if (!profile || profile.role !== 'owner' || !profile.is_active) return error(req, 'FORBIDDEN', 403);

  let parsed: Body | string;
  try {
    parsed = parse(await req.json());
  } catch {
    parsed = 'INVALID_BODY';
  }
  if (typeof parsed === 'string') return error(req, parsed, 400);
  const body = parsed;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    app_metadata: { role: body.role, full_name: body.full_name, language: 'ar' },
    user_metadata: { full_name: body.full_name },
  });
  if (createError || !created.user) {
    const msg = createError?.message ?? '';
    return error(req, /already|exists|registered/i.test(msg) ? 'EMAIL_TAKEN' : 'CREATE_FAILED', 400);
  }
  const userId = created.user.id;

  if (body.pin) {
    // set_pin enforces PIN uniqueness; executed as the (owner) caller.
    const { error: pinError } = await caller.rpc('set_pin', { p_user_id: userId, p_pin: body.pin });
    if (pinError) {
      await admin.auth.admin.deleteUser(userId);
      return error(req, pinError.message.includes('PIN_TAKEN') ? 'PIN_TAKEN' : 'INVALID_PIN', 400);
    }
  }

  if (body.employee_id) {
    await admin.from('employees_meta').update({ profile_id: userId }).eq('id', body.employee_id).is('profile_id', null);
  } else {
    await admin.from('employees_meta').insert({ profile_id: userId, full_name: body.full_name, position: ROLE_LABEL_AR[body.role] });
  }

  await admin.from('audit_log').insert({
    user_id: me.user.id,
    action: 'create_user',
    entity: 'profile',
    entity_id: userId,
    details: { email: body.email, role: body.role },
  });

  return json(req, { user_id: userId });
});
