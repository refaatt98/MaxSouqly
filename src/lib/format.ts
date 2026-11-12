import type { Language } from '@/i18n';

export type DigitStyle = 'latin' | 'arabic';

export interface FormatOptions {
  lang: Language;
  digits: DigitStyle;
  currencySymbol: string;
}

export interface Formatter {
  money: (value: number | null | undefined) => string;
  number: (value: number | null | undefined, maxFraction?: number) => string;
  percent: (value: number | null | undefined, maxFraction?: number) => string;
  date: (value: string | Date) => string;
  shortDate: (value: string | Date) => string;
  time: (value: string | Date, seconds?: boolean) => string;
  dateTime: (value: string | Date) => string;
  monthYear: (value: string | Date) => string;
  /** e.g. الخميس، 12 نوفمبر 2026 — used as the top-bar title */
  weekdayDate: (value: string | Date) => string;
  digits: (text: string | number) => string;
}

function locale({ lang, digits }: FormatOptions): string {
  const base = lang === 'he' ? 'he' : 'ar';
  return `${base}-u-nu-${digits === 'arabic' ? 'arab' : 'latn'}`;
}

const cache = new Map<string, Formatter>();

export function createFormatter(opts: FormatOptions): Formatter {
  const key = `${opts.lang}|${opts.digits}|${opts.currencySymbol}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const loc = locale(opts);
  const toDate = (v: string | Date) => (typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : v);
  const numberFormats = new Map<number, Intl.NumberFormat>();
  const nf = (maxFraction: number) => {
    let f = numberFormats.get(maxFraction);
    if (!f) {
      f = new Intl.NumberFormat(loc, { maximumFractionDigits: maxFraction });
      numberFormats.set(maxFraction, f);
    }
    return f;
  };
  // Currency via Intl (ILS), rendered as "₪ 12,850" with the configured symbol.
  const currency = new Intl.NumberFormat(loc, { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const dateF = new Intl.DateTimeFormat(loc, { year: 'numeric', month: 'long', day: 'numeric' });
  const shortDateF = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric' });
  const timeF = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' });
  const timeSecF = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateTimeF = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const monthF = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' });
  const weekdayF = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

  const f: Formatter = {
    money: (value) => {
      const v = Number(value ?? 0);
      const parts = currency.formatToParts(Math.abs(v));
      const num = parts
        .filter((p) => p.type !== 'currency' && p.type !== 'literal')
        .map((p) => p.value)
        .join('')
        .trim();
      return `${v < 0 ? '-' : ''}${opts.currencySymbol} ${num}`;
    },
    number: (value, maxFraction = 2) => nf(maxFraction).format(Number(value ?? 0)),
    percent: (value, maxFraction = 0) => `${nf(maxFraction).format(Number(value ?? 0))}%`,
    date: (v) => dateF.format(toDate(v)),
    shortDate: (v) => shortDateF.format(toDate(v)),
    time: (v, seconds = false) => (seconds ? timeSecF : timeF).format(toDate(v)),
    dateTime: (v) => dateTimeF.format(toDate(v)),
    monthYear: (v) => monthF.format(toDate(v)),
    weekdayDate: (v) => weekdayF.format(toDate(v)),
    digits: (text) =>
      opts.digits === 'arabic' ? String(text).replace(/[0-9]/g, (d) => arabicDigits[Number(d)]) : String(text),
  };
  cache.set(key, f);
  return f;
}

/** Percent change helper for trend chips. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
