import { Bell, Command, Search } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useNow } from '@/hooks/useNow';
import { useAuth } from '../providers/AuthProvider';
import { useConnection } from '../providers/ConnectionProvider';
import { useNotifications } from '../providers/NotificationsProvider';
import { useFormat } from '../providers/SettingsProvider';
import { CountBadge } from '@/components/ui/Badge';
import { NotificationsPanel } from './NotificationsPanel';
import { BrandMark } from './BrandMark';

export function ConnectionPill({ className }: { className?: string }) {
  const t = useT();
  const { online } = useConnection();
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
        online ? 'border-success/25 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger',
        className,
      )}
    >
      <span className="relative flex size-2">
        {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
        <span className={cn('relative inline-flex size-2 rounded-full', online ? 'bg-success' : 'bg-danger')} />
      </span>
      {online ? t('topbar.online') : t('topbar.offline')}
    </span>
  );
}

export function LiveClock({ className }: { className?: string }) {
  const now = useNow(1000);
  const f = useFormat();
  return (
    <time className={cn('num', className)} dateTime={new Date(now).toISOString()}>
      {f.time(new Date(now), true)}
    </time>
  );
}

export function TopBar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const t = useT();
  const f = useFormat();
  const { profile } = useAuth();
  const { unread } = useNotifications();
  const [panelOpen, setPanelOpen] = useState(false);
  const firstName = profile?.full_name.split(' ')[0] ?? '';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:h-20 md:px-6">
      <div className="md:hidden">
        <BrandMark size="sm" />
      </div>
      <div className="hidden min-w-0 md:block">
        <p className="truncate text-lg font-bold">{t('topbar.greeting', { name: firstName })} 👋</p>
        <p className="text-xs text-fg-3">
          {f.date(new Date())} · <LiveClock />
        </p>
      </div>
      <div className="ms-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenCommand}
          className="hidden h-10 items-center gap-2 rounded-btn border border-line bg-surface px-3 text-sm text-fg-3 transition-colors hover:border-line-strong hover:text-fg lg:flex"
        >
          <Search className="size-4" />
          <span>{t('topbar.commandHint')}</span>
          <kbd className="ms-4 inline-flex items-center gap-0.5 rounded border border-line px-1.5 text-[11px]" dir="ltr">
            <Command className="size-3" />K
          </kbd>
        </button>
        <button type="button" onClick={onOpenCommand} className="grid size-10 place-items-center rounded-btn text-fg-2 hover:bg-white/5 lg:hidden" aria-label={t('topbar.commandHint')}>
          <Search className="size-5" />
        </button>
        <ConnectionPill />
        <div className="relative">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={t('topbar.notifications')}
            aria-expanded={panelOpen}
            className="relative grid size-10 place-items-center rounded-btn text-fg-2 transition-colors hover:bg-white/5 hover:text-fg"
          >
            <Bell className="size-5" />
            <CountBadge count={unread} className="absolute -end-1 -top-1" />
          </button>
          <NotificationsPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
        </div>
      </div>
    </header>
  );
}
