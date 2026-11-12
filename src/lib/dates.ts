// Date helpers (no library). Dates exchanged with the server are local ISO dates (YYYY-MM-DD).

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Index of a weekday where Saturday = 0 … Friday = 6. */
export function satIndex(d: Date): number {
  return (d.getDay() + 1) % 7;
}

/** The week starts on Saturday (السبت). */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, -satIndex(r));
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export type RangePreset = 'today' | '7d' | '30d' | 'custom';

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): { from: string; to: string } {
  const to = toISODate(now);
  if (preset === 'today') return { from: to, to };
  return { from: toISODate(addDays(now, preset === '7d' ? -6 : -29)), to };
}

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

/** Start/end timestamps (ISO) for a local inclusive date range. */
export function rangeToTimestamps(from: string, to: string): { start: string; end: string } {
  return { start: parseISODate(from).toISOString(), end: addDays(parseISODate(to), 1).toISOString() };
}
