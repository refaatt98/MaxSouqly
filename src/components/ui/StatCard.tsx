import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AnimatedNumber } from './AnimatedNumber';
import { Skeleton } from './Skeleton';

export type StatTone = 'green' | 'blue' | 'gold' | 'red';

const tones: Record<StatTone, { card: string; tile: string; glow: string }> = {
  green: {
    card: 'from-[#0f2a1b] via-[#11211a] to-card border-success/20',
    tile: 'bg-success/20 text-success',
    glow: 'bg-success/25',
  },
  blue: {
    card: 'from-[#0f1d3d] via-[#121a2e] to-card border-info/25',
    tile: 'bg-info/25 text-[#7aa5ff]',
    glow: 'bg-info/30',
  },
  gold: {
    card: 'from-[#33270a] via-[#231d10] to-card border-gold/25',
    tile: 'bg-gold/20 text-gold',
    glow: 'bg-gold/25',
  },
  red: {
    card: 'from-[#3a0d12] via-[#24121a] to-card border-brand/25',
    tile: 'bg-brand/25 text-[#ff6b77]',
    glow: 'bg-brand/30',
  },
};

export function TrendChip({ value, label }: { value: number | null; label?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span
      title={label}
      className={cn(
        'num inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold',
        up ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
      )}
    >
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      <span dir="ltr">
        {up ? '+' : ''}
        {value.toFixed(0)}%
      </span>
    </span>
  );
}

export function StatCard({ label, value, format, icon, tone, trend, trendLabel, loading, footer, delay = 0 }: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: ReactNode;
  tone: StatTone;
  trend?: number | null;
  trendLabel?: string;
  loading?: boolean;
  footer?: ReactNode;
  delay?: number;
}) {
  const s = tones[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className={cn('relative overflow-hidden rounded-card border bg-gradient-to-bl p-5 shadow-card', s.card)}
    >
      <div className={cn('pointer-events-none absolute -end-10 -top-10 size-36 rounded-full blur-3xl', s.glow)} aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-2">{label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-36" />
          ) : (
            <p className="num mt-2 text-3xl font-bold tracking-tight text-fg">
              <AnimatedNumber value={value} format={format} />
            </p>
          )}
        </div>
        <span className={cn('grid size-12 shrink-0 place-items-center rounded-card', s.tile)}>{icon}</span>
      </div>
      <div className="relative mt-4 flex items-center gap-2 text-xs text-fg-3">
        {!loading && <TrendChip value={trend ?? null} label={trendLabel} />}
        {trendLabel && !loading && trend !== null && trend !== undefined && <span>{trendLabel}</span>}
        {footer}
      </div>
    </motion.div>
  );
}
