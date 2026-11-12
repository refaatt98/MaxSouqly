import { isTranslationKey, type TFunction, type TranslationKey } from '@/i18n';

export interface ErrorInfo {
  key: TranslationKey;
  detail?: string;
}

interface MaybeError {
  message?: unknown;
  code?: unknown;
  error?: unknown;
}

/** Maps Supabase / Postgres / network errors to a translated message key. */
export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) return { key: 'errors.network' };
  const e = (typeof err === 'object' && err !== null ? err : {}) as MaybeError;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : typeof e.error === 'string' ? e.error : '';

  // Our functions raise "CODE" or "CODE:detail".
  const match = /^([A-Z][A-Z_]+)(?::\s*(.*))?/.exec(message.trim());
  if (match) {
    const key = `errors.${match[1]}`;
    if (isTranslationKey(key)) return { key, detail: match[2] };
  }
  if (/INCOMPATIBLE_UNITS/.test(message)) return { key: 'errors.INCOMPATIBLE_UNITS' };
  if (code === '23503') return { key: 'errors.FOREIGN_KEY' };
  if (code === '23505') return { key: 'errors.DUPLICATE' };
  if (code === '42501' || /permission denied|row-level security/i.test(message)) return { key: 'errors.FORBIDDEN' };
  if (/JWT|not authenticated/i.test(message)) return { key: 'errors.NOT_AUTHENTICATED' };
  if (/Failed to fetch|NetworkError|network/i.test(message)) return { key: 'errors.network' };
  return { key: 'errors.generic' };
}

export function errorMessage(t: TFunction, err: unknown): string {
  const info = toErrorInfo(err);
  return t(info.key, { detail: info.detail ?? '' });
}

export function isNetworkError(err: unknown): boolean {
  return toErrorInfo(err).key === 'errors.network';
}
