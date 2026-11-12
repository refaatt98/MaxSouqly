import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <span className="grid size-11 shrink-0 place-items-center rounded-card bg-brand/15 text-[#ff5a67]">{icon}</span>}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
