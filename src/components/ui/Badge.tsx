import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'red' | 'green' | 'gold' | 'blue' | 'amber';

const tones: Record<Tone, string> = {
  neutral: 'bg-white/6 text-fg-2 border-line',
  red: 'bg-brand/12 text-[#ff5a67] border-brand/25',
  green: 'bg-success/12 text-success border-success/25',
  gold: 'bg-gold/12 text-gold border-gold/25',
  blue: 'bg-info/15 text-[#6b9bff] border-info/30',
  amber: 'bg-warning/12 text-warning border-warning/25',
};

export function Badge({ tone = 'neutral', children, icon, dot, className }: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'num inline-grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] leading-5 font-bold text-white shadow-glow-sm',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
