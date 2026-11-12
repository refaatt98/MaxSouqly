import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function EmptyState({ icon, title, body, action, className }: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-card border border-line bg-elevated text-fg-3">{icon}</div>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-fg-3">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm text-danger">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-btn border border-line-strong px-4 py-2 text-sm text-fg hover:bg-black/5">
          {retryLabel}
        </button>
      )}
    </div>
  );
}
