import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'red' | 'green' | 'gold' | 'blue' | 'amber';

const tones: Record<Tone, string> = {
  neutral: 'bg-black/[0.04] text-fg-2 border-line',
  red: 'bg-danger/10 text-[#b91c1c] border-danger/20',
  green: 'bg-success/10 text-success border-success/20',
  gold: 'bg-warning/10 text-warning border-warning/20',
  blue: 'bg-black/[0.04] text-fg-2 border-line',
  amber: 'bg-warning/10 text-warning border-warning/20',
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

/** Quiet count. `alert` is reserved for the one count that needs attention (unread notifications). */
export function CountBadge({ count, className, alert = false }: { count: number; className?: string; alert?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'mono inline-grid min-w-5 place-items-center rounded-[6px] px-1.5 text-[11px] leading-5 font-medium',
        alert ? 'bg-brand text-white' : 'bg-black/[0.06] text-fg-2',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
