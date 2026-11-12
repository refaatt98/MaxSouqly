import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AnimatedNumber } from './AnimatedNumber';
import { Skeleton } from './Skeleton';

export type StatTone = 'green' | 'blue' | 'gold' | 'red';

/** Change vs a reference period, as quiet text: "↓ 5% مقارنة بالأمس". */
export function TrendChip({ value, label }: { value: number | null; label?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span className="inline-flex items-center gap-1 text-[13px]">
      <span className={cn('num inline-flex items-center gap-0.5 font-medium', up ? 'text-success' : 'text-danger')}>
        {up ? <ArrowUp className="size-3.5" strokeWidth={1.75} /> : <ArrowDown className="size-3.5" strokeWidth={1.75} />}
        <span dir="ltr">{Math.abs(value).toFixed(0)}%</span>
      </span>
      {label && <span className="text-fg-3">{label}</span>}
    </span>
  );
}

/**
 * A stat card is a number: label, figure, and its change against a stated reference.
 * `icon` and `tone` are accepted for API compatibility but intentionally not rendered as decoration.
 */
export function StatCard({ label, value, format, trend, trendLabel, loading, footer, delay = 0, emphasis = false }: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon?: ReactNode;
  tone?: StatTone;
  trend?: number | null;
  trendLabel?: string;
  loading?: boolean;
  footer?: ReactNode;
  delay?: number;
  /** the one figure on the screen that matters gets the accent */
  emphasis?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card border border-line bg-card px-5 py-4"
    >
      <p className="flex items-center gap-2 text-[13px] text-fg-2">
        {emphasis && <span className="slash" aria-hidden />}
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-32" />
      ) : (
        <p className="num mt-2 text-[30px] leading-none font-medium text-fg">
          <AnimatedNumber value={value} format={format} />
        </p>
      )}
      <div className="mt-3 flex min-h-5 items-center gap-2">
        {!loading && <TrendChip value={trend ?? null} label={trend !== null && trend !== undefined ? trendLabel : undefined} />}
        {footer}
      </div>
    </motion.div>
  );
}
