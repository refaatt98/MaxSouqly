import { Bell, Command, Search } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useNow } from '@/hooks/useNow';
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
    <span role="status" className={cn('inline-flex items-center gap-2 px-2 text-[13px]', online ? 'text-fg-2' : 'text-danger', className)}>
      <span className={cn('size-2 rounded-full', online ? 'bg-success' : 'bg-danger')} aria-hidden />
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
  const { unread } = useNotifications();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg px-4 md:px-6">
      <div className="md:hidden">
        <BrandMark size="sm" />
      </div>
      <div className="hidden min-w-0 md:block">
        <p className="truncate text-[15px] font-medium text-fg">{f.weekdayDate(new Date())}</p>
        <LiveClock className="text-[13px] text-fg-3" />
      </div>
      <div className="ms-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenCommand}
          className="hidden h-9 items-center gap-2 rounded-btn border border-line bg-card px-3 text-sm text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2 lg:flex"
        >
          <Search className="size-4" strokeWidth={1.5} />
          <span>{t('topbar.commandHint')}</span>
          <kbd className="mono ms-6 inline-flex items-center gap-0.5 rounded-[4px] border border-line bg-elevated px-1.5 text-[11px] text-fg-3" dir="ltr">
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
            <Bell className="size-[18px]" strokeWidth={1.5} />
            <CountBadge count={unread} alert className="absolute -end-1 -top-1" />
          </button>
          <NotificationsPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
        </div>
      </div>
    </header>
  );
}
