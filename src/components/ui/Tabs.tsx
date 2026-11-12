import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CountBadge } from './Badge';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
  count?: number;
}

/** Underlined sub-navigation (used for module sub-nav). */
export function Tabs<K extends string>({ items, value, onChange, className }: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  layoutId?: string;
}) {
  return (
    <div role="tablist" className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={cn(
              'relative flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {active ? <span className="slash" aria-hidden /> : it.icon}
            {it.label}
            {it.count !== undefined && <CountBadge count={it.count} />}
          </button>
        );
      })}
    </div>
  );
}

/** Pill segmented control. */
export function Segmented<K extends string>({ items, value, onChange, className, size = 'md', layoutId = 'seg' }: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  layoutId?: string;
}) {
  const h = size === 'sm' ? 'h-9 text-xs' : size === 'lg' ? 'h-12 text-base' : 'h-10 text-sm';
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-btn border border-line bg-surface p-1', className)}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.key)}
            className={cn('relative flex flex-1 items-center justify-center gap-2 rounded-[6px] px-3 font-medium whitespace-nowrap transition-colors', h, active ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
          >
            {active && (
              <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[6px] border border-line-strong bg-elevated shadow-glow-sm" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} />
            )}
            <span className="relative flex items-center gap-2">
              {it.icon}
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
