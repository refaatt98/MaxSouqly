import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-card shadow-card', className)} {...rest} />;
}

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-panel border border-line bg-surface shadow-panel', className)} {...rest} />;
}

export function CardHeader({ title, subtitle, actions, icon, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <span className="grid size-10 shrink-0 place-items-center rounded-btn bg-white/5 text-fg-2">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-fg">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
