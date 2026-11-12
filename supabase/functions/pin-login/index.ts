// pin-login: exchange a 4–6 digit staff PIN for a Supabase session.
// The PIN is verified in Postgres (bcrypt via pgcrypto). Brute force is limited
// per client IP: 5 failures in 10 minutes locks that IP for the window.
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---- HTTP helpers (inlined so the function is a single file)
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  // When ALLOWED_ORIGINS is not configured (local dev) any origin is echoed back.
  const allow = allowedOrigins.length === 0 || allowedOrigins.includes(origin) ? origin || '*' : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function error(req: Request, code: string, status: number): Response {
  return json(req, { error: code }, status);
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== 'POST') return error(req, 'METHOD_NOT_ALLOWED', 405);

  let pin = '';
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = typeof body.pin === 'string' ? body.pin : '';
  } catch {
    return error(req, 'INVALID_BODY', 400);
  }
  if (!/^[0-9]{4,6}$/.test(pin)) return error(req, 'INVALID_PIN', 400);

  const url = env('SUPABASE_URL');
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await admin
    .from('pin_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('success', false)
    .gte('created_at', since);
  if ((count ?? 0) >= MAX_FAILURES) return error(req, 'TOO_MANY_ATTEMPTS', 429);

  const { data: userId, error: rpcError } = await admin.rpc('verify_pin', { p_pin: pin });
  if (rpcError) return error(req, 'SERVER_ERROR', 500);
  if (!userId) {
    await admin.from('pin_attempts').insert({ ip, success: false });
    return error(req, 'WRONG_PIN', 401);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId as string);
  if (userError || !userData.user?.email) return error(req, 'SERVER_ERROR', 500);

  // Mint a one-time magic-link token server side and redeem it immediately.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
  });
  if (linkError || !link.properties?.hashed_token) return error(req, 'SERVER_ERROR', 500);

  const anon = createClient(url, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyError || !verified.session) return error(req, 'SERVER_ERROR', 500);

  await admin.from('pin_attempts').insert({ ip, success: true });
  await admin.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', userId);

  return json(req, {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
});
