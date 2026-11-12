/**
 * MAX image service — Cloudflare Worker in front of the R2 bucket `MAX_IMAGES`.
 *
 *   POST   /upload        multipart/form-data { folder, file }  → { url, key }
 *   DELETE /object/:key   deletes an object (same auth rules)
 *   GET    /object/:key   public read with long-lived cache headers (fallback when no R2 custom domain)
 *
 * Auth: `Authorization: Bearer <Supabase access token>`, verified with GET /auth/v1/user.
 * The caller's role is read from public.profiles through PostgREST *as the caller* (RLS applies).
 */

export interface Env {
  MAX_IMAGES: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  PUBLIC_URL: string;
  ALLOWED_ORIGINS: string;
}

type Role = 'owner' | 'manager' | 'cashier' | 'kitchen' | 'inventory';
type Folder = 'menu' | 'ingredients' | 'avatars' | 'receipts' | 'branding';

const MAX_BYTES = 5 * 1024 * 1024;
const FOLDERS: Folder[] = ['menu', 'ingredients', 'avatars', 'receipts', 'branding'];

/** Who may write to each folder. Avatars: everyone, but only inside their own prefix (managers: any). */
const WRITE_ROLES: Record<Folder, Role[]> = {
  menu: ['owner', 'manager'],
  ingredients: ['owner', 'manager', 'inventory'],
  avatars: ['owner', 'manager', 'cashier', 'kitchen', 'inventory'],
  receipts: ['owner', 'manager'],
  branding: ['owner'],
};

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ------------------------------------------------------------------ helpers
function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, env), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Detects the real image type from magic bytes (never trust the declared MIME type alone). */
function sniff(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

interface Caller {
  id: string;
  role: Role;
}

async function authenticate(req: Request, env: Env): Promise<Caller | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const headers = { Authorization: auth, apikey: env.SUPABASE_ANON_KEY };

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as { id?: string };
  if (!user.id) return null;

  const profRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_active`, {
    headers: { ...headers, Accept: 'application/json' },
  });
  if (!profRes.ok) return null;
  const rows = (await profRes.json()) as { role: Role; is_active: boolean }[];
  const profile = rows[0];
  if (!profile || !profile.is_active) return null;
  return { id: user.id, role: profile.role };
}

function canWrite(caller: Caller, folder: Folder, key?: string): boolean {
  if (!WRITE_ROLES[folder].includes(caller.role)) return false;
  if (folder === 'avatars' && caller.role !== 'owner' && caller.role !== 'manager') {
    // staff may only touch objects under avatars/<their user id>/
    return key === undefined || key.startsWith(`avatars/${caller.id}/`);
  }
  return true;
}

function folderOf(key: string): Folder | null {
  const first = key.split('/')[0] as Folder;
  return FOLDERS.includes(first) ? first : null;
}

function validKey(key: string): boolean {
  return /^[a-z]+\/(?:[0-9a-f-]{36}\/)?[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(key);
}

// ------------------------------------------------------------------ routes
async function upload(req: Request, env: Env): Promise<Response> {
  const caller = await authenticate(req, env);
  if (!caller) return json(req, env, { error: 'NOT_AUTHENTICATED' }, 401);

  const length = Number(req.headers.get('Content-Length') ?? '0');
  if (length > MAX_BYTES + 64 * 1024) return json(req, env, { error: 'UPLOAD_SIZE' }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(req, env, { error: 'INVALID_BODY' }, 400);
  }
  const folder = form.get('folder');
  const file = form.get('file');
  if (typeof folder !== 'string' || !FOLDERS.includes(folder as Folder)) return json(req, env, { error: 'INVALID_FOLDER' }, 400);
  if (!file || typeof file === 'string') return json(req, env, { error: 'INVALID_BODY' }, 400);
  if (!canWrite(caller, folder as Folder)) return json(req, env, { error: 'FORBIDDEN' }, 403);
  if (file.size > MAX_BYTES) return json(req, env, { error: 'UPLOAD_SIZE' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type || !MIME_EXT[file.type] || type !== file.type) return json(req, env, { error: 'UPLOAD_TYPE' }, 415);

  const id = crypto.randomUUID();
  const key = folder === 'avatars' ? `avatars/${caller.id}/${id}.${MIME_EXT[type]}` : `${folder}/${id}.${MIME_EXT[type]}`;
  await env.MAX_IMAGES.put(key, bytes, {
    httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { uploadedBy: caller.id },
  });
  return json(req, env, { url: `${env.PUBLIC_URL.replace(/\/$/, '')}/${key}`, key }, 201);
}

async function remove(req: Request, env: Env, key: string): Promise<Response> {
  const caller = await authenticate(req, env);
  if (!caller) return json(req, env, { error: 'NOT_AUTHENTICATED' }, 401);
  const folder = folderOf(key);
  if (!folder || !validKey(key)) return json(req, env, { error: 'INVALID_KEY' }, 400);
  if (!canWrite(caller, folder, key)) return json(req, env, { error: 'FORBIDDEN' }, 403);
  await env.MAX_IMAGES.delete(key);
  return json(req, env, { deleted: key });
}

async function serve(req: Request, env: Env, key: string): Promise<Response> {
  if (!validKey(key)) return new Response('Not found', { status: 404 });
  const obj = await env.MAX_IMAGES.get(key, { onlyIf: req.headers });
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });

    try {
      if (url.pathname === '/upload' && req.method === 'POST') return await upload(req, env);
      if (url.pathname.startsWith('/object/')) {
        const key = decodeURIComponent(url.pathname.slice('/object/'.length));
        if (req.method === 'DELETE') return await remove(req, env, key);
        if (req.method === 'GET' || req.method === 'HEAD') return await serve(req, env, key);
      }
      return json(req, env, { error: 'NOT_FOUND' }, 404);
    } catch {
      return json(req, env, { error: 'SERVER_ERROR' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
