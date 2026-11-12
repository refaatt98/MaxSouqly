import type { TFunction } from '@/i18n';

/** Small typed validation helpers returning Arabic/Hebrew messages (or null when valid). */
export const v = {
  required: (t: TFunction, value: string) => (value.trim() ? null : t('common.required')),
  maxLen: (t: TFunction, value: string, max: number) => (value.length > max ? t('validation.tooLong') : null),
  minLen: (t: TFunction, value: string, min: number) => (value.trim().length < min ? t('validation.minLength', { min }) : null),
  number: (t: TFunction, value: string, opts: { min?: number; max?: number; integer?: boolean; positive?: boolean } = {}) => {
    if (value.trim() === '') return t('common.required');
    const n = Number(value);
    if (!Number.isFinite(n) || (opts.integer && !Number.isInteger(n))) return t('validation.number');
    if (opts.positive && n <= 0) return t('validation.positive');
    if (opts.min !== undefined && n < opts.min) return opts.min === 0 ? t('validation.nonNegative') : t('validation.min', { min: opts.min });
    if (opts.max !== undefined && n > opts.max) return t('validation.max', { max: opts.max });
    return null;
  },
  email: (t: TFunction, value: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : t('errors.INVALID_EMAIL')),
  phone: (t: TFunction, value: string) => (!value.trim() || /^[0-9+\- ]{7,20}$/.test(value.trim()) ? null : t('validation.phone')),
};

export type Errors<K extends string> = Partial<Record<K, string | null>>;

export function hasErrors<K extends string>(errors: Errors<K>): boolean {
  return Object.values(errors).some(Boolean);
}
