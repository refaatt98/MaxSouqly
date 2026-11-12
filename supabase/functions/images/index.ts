// images: authenticated image upload/delete to Cloudflare R2 (S3 API, SigV4 signed — no SDK).
//   POST   /functions/v1/images/upload        multipart { folder, file } → { url, key }
//   DELETE /functions/v1/images/object/<key>
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
import { createClient } from 'npm:@supabase/supabase-js@2';

type Role = 'owner' | 'manager' | 'cashier' | 'kitchen' | 'inventory';
type Folder = 'menu' | 'categories' | 'ingredients' | 'avatars' | 'receipts' | 'branding';

const MAX_BYTES = 5 * 1024 * 1024;
const WRITE_ROLES: Record<Folder, Role[]> = {
  menu: ['owner', 'manager'],
  categories: ['owner', 'manager'],
  ingredients: ['owner', 'manager', 'inventory'],
  avatars: ['owner', 'manager', 'cashier', 'kitchen', 'inventory'],
  receipts: ['owner', 'manager'],
  branding: ['owner'],
};
const FOLDERS = Object.keys(WRITE_ROLES) as Folder[];
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ SigV4
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data: Uint8Array | string) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

async function r2(method: 'PUT' | 'DELETE', key: string, body?: Uint8Array, extra: Record<string, string> = {}): Promise<Response> {
  const host = `${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
  const path = `/${env('R2_BUCKET')}/${encodeKey(key)}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = await sha256(body ?? new Uint8Array());
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonical = [method, path, '', names.map((n) => `${n}:${lower[n]}`).join('\n') + '\n', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac(enc.encode('AWS4' + env('R2_SECRET_ACCESS_KEY')), day);
  for (const part of ['auto', 's3', 'aws4_request']) k = await hmac(k, part);
  const signature = hex(await hmac(k, toSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${env('R2_ACCESS_KEY_ID')}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const { host: _h, ...sendHeaders } = headers;
  return fetch(`https://${host}${path}`, { method, headers: { ...sendHeaders, Authorization: auth }, body });
}

// ------------------------------------------------------------------ auth
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

async function caller(req: Request): Promise<{ id: string; role: Role } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await sb.from('profiles').select('role, is_active').eq('id', data.user.id).maybeSingle();
  if (!p || !p.is_active) return null;
  return { id: data.user.id, role: p.role as Role };
}

function allowed(c: { id: string; role: Role }, folder: Folder, key?: string): boolean {
  if (!WRITE_ROLES[folder].includes(c.role)) return false;
  if (folder === 'avatars' && c.role !== 'owner' && c.role !== 'manager') return key === undefined || key.startsWith(`avatars/${c.id}/`);
  return true;
}

// ------------------------------------------------------------------ routes
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/images/, '');
  try {
    const c = await caller(req);
    if (!c) return json({ error: 'NOT_AUTHENTICATED' }, 401);

    if (req.method === 'POST' && path === '/upload') {
      const form = await req.formData();
      const folder = form.get('folder');
      const file = form.get('file');
      if (typeof folder !== 'string' || !FOLDERS.includes(folder as Folder)) return json({ error: 'INVALID_FOLDER' }, 400);
      if (!(file instanceof File)) return json({ error: 'INVALID_BODY' }, 400);
      if (!allowed(c, folder as Folder)) return json({ error: 'FORBIDDEN' }, 403);
      if (file.size > MAX_BYTES) return json({ error: 'UPLOAD_SIZE' }, 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = sniff(bytes);
      if (!type || !EXT[file.type] || type !== file.type) return json({ error: 'UPLOAD_TYPE' }, 415);
      const id = crypto.randomUUID();
      const key = folder === 'avatars' ? `avatars/${c.id}/${id}.${EXT[type]}` : `${folder}/${id}.${EXT[type]}`;
      const res = await r2('PUT', key, bytes, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' });
      if (!res.ok) return json({ error: 'UPLOAD_FAILED', status: res.status }, 502);
      return json({ url: `${env('R2_PUBLIC_URL').replace(/\/$/, '')}/${key}`, key }, 201);
    }

    if (req.method === 'DELETE' && path.startsWith('/object/')) {
      const key = decodeURIComponent(path.slice('/object/'.length));
      const folder = key.split('/')[0] as Folder;
      if (!FOLDERS.includes(folder) || !/^[a-z]+\/(?:[0-9a-f-]{36}\/)?[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(key)) return json({ error: 'INVALID_KEY' }, 400);
      if (!allowed(c, folder, key)) return json({ error: 'FORBIDDEN' }, 403);
      const res = await r2('DELETE', key);
      if (!res.ok && res.status !== 404) return json({ error: 'DELETE_FAILED' }, 502);
      return json({ deleted: key });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch {
    return json({ error: 'SERVER_ERROR' }, 500);
  }
});
