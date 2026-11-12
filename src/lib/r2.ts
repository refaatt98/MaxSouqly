import { env } from './env';
import { supabase } from './supabase';

export type UploadFolder = 'menu' | 'ingredients' | 'avatars' | 'receipts' | 'branding';

export class UploadError extends Error {
  constructor(public code: 'UPLOAD_TYPE' | 'UPLOAD_SIZE' | 'UPLOAD_FAILED' | 'UPLOAD_NOT_CONFIGURED' | 'FORBIDDEN') {
    super(code);
  }
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 1200;

export function validateImage(file: File): void {
  if (!ACCEPTED.includes(file.type)) throw new UploadError('UPLOAD_TYPE');
  if (file.size > MAX_BYTES) throw new UploadError('UPLOAD_SIZE');
}

/** Resizes to max 1200px on the long edge and re-encodes to WebP with <canvas>. */
export async function compressToWebp(file: File, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadError('UPLOAD_FAILED');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new UploadError('UPLOAD_FAILED');
  // Some browsers silently fall back to PNG; still within limits after resize.
  if (blob.size > MAX_BYTES) throw new UploadError('UPLOAD_SIZE');
  return blob;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UploadError('FORBIDDEN');
  return token;
}

/** Uploads through the Cloudflare Worker; resolves to the public URL. */
export async function uploadImage(blob: Blob, folder: UploadFolder, onProgress?: (pct: number) => void): Promise<string> {
  if (!env.r2WorkerUrl) throw new UploadError('UPLOAD_NOT_CONFIGURED');
  const token = await accessToken();
  const form = new FormData();
  form.append('folder', folder);
  form.append('file', blob, `upload.${blob.type === 'image/webp' ? 'webp' : blob.type.split('/')[1] ?? 'bin'}`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${env.r2WorkerUrl}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { url?: string; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
        else if (xhr.status === 403) reject(new UploadError('FORBIDDEN'));
        else if (body.error === 'UPLOAD_TYPE' || body.error === 'UPLOAD_SIZE') reject(new UploadError(body.error));
        else reject(new UploadError('UPLOAD_FAILED'));
      } catch {
        reject(new UploadError('UPLOAD_FAILED'));
      }
    };
    xhr.onerror = () => reject(new UploadError('UPLOAD_FAILED'));
    xhr.send(form);
  });
}

/** Object key for a URL served from our bucket (null for anything else, e.g. bundled images). */
export function objectKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || !env.r2PublicUrl || !url.startsWith(env.r2PublicUrl + '/')) return null;
  return url.slice(env.r2PublicUrl.length + 1);
}

/** Deletes an object we own. Failures are swallowed: a stale object must never block a save. */
export async function deleteImage(url: string | null | undefined): Promise<void> {
  const key = objectKeyFromUrl(url);
  if (!key || !env.r2WorkerUrl) return;
  try {
    const token = await accessToken();
    await fetch(`${env.r2WorkerUrl}/object/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore */
  }
}
