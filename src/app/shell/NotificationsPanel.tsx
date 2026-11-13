import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Ban, BellOff, Boxes, ClipboardList, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useNotifications } from '../providers/NotificationsProvider';
import { useAuth } from '../providers/AuthProvider';
import { useFormat } from '../providers/SettingsProvider';
import { canAccess } from '../nav';
import { usePermissions } from '../providers/PermissionsProvider';
import type { AppNotification } from '@/types/models';

const icon = {
  low_stock: <Boxes className="size-4 text-fg-3" strokeWidth={1.5} />,
  new_order: <ClipboardList className="size-4 text-fg-3" strokeWidth={1.5} />,
  void: <Ban className="size-4 text-fg-3" strokeWidth={1.5} />,
  system: <Info className="size-4 text-fg-3" strokeWidth={1.5} />,
};

export function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormat();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { can } = usePermissions();
  const { items, isUnread, markAllRead, markRead } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const openItem = (n: AppNotification) => {
    void markRead(n.id);
    onClose();
    if (n.type === 'low_stock' && canAccess(role, '/inventory', can)) navigate('/inventory');
    else if ((n.type === 'new_order' || n.type === 'void') && n.ref_id && canAccess(role, '/orders', can)) navigate(`/orders?id=${n.ref_id}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="glass absolute end-0 top-12 z-40 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-panel border border-line-strong shadow-panel"
          role="dialog"
          aria-label={t('notifications.title')}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-medium">{t('notifications.title')}</h2>
            <button type="button" onClick={() => void markAllRead()} className="text-xs text-fg-2 hover:text-fg">
              {t('notifications.markAll')}
            </button>
          </div>
          <ul className="max-h-[60dvh] overflow-y-auto">
            {items.length === 0 && (
              <li className="flex flex-col items-center gap-2 px-4 py-10 text-sm text-fg-3">
                <BellOff className="size-6" />
                {t('notifications.empty')}
              </li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn('flex w-full items-start gap-3 border-b border-line px-4 py-3 text-start transition-colors hover:bg-fg/[0.04]', isUnread(n) && 'bg-fg/[0.02]')}
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-btn bg-fg/5">{icon[n.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-fg-3">{n.body}</span>}
                    <span className="mt-1 block text-[0.6875rem] text-fg-3">
                      {t(`notifications.type.${n.type}`)} · {f.dateTime(n.created_at)}
                    </span>
                  </span>
                  {isUnread(n) && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />}
                </button>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
