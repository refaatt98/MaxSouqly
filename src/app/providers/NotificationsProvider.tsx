import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtime } from '@/hooks/useRealtime';
import type { AppNotification } from '@/types/models';
import { useAuth } from './AuthProvider';
import { useSettings } from './SettingsProvider';
import { useToast } from './ToastProvider';

interface NotificationsContextValue {
  items: AppNotification[];
  unread: number;
  isUnread: (n: AppNotification) => boolean;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { profile, role, status } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[]>([]);
  const uid = profile?.id ?? '';

  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40)
      .then(({ data }) => {
        if (!cancelled && data) setItems(data);
      });
    return () => {
      cancelled = true;
    };
  }, [status, uid]);

  useRealtime(status === 'signedIn' ? { table: 'notifications' } : null, (p) => {
    if (p.eventType === 'INSERT') {
      const n = p.new;
      if (!role || !n.target_roles.includes(role)) return;
      setItems((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 40));
      // The kitchen screen has its own new-order alert; elsewhere show a toast.
      if (n.type === 'new_order' && role !== 'kitchen' && settings?.order_notifications) toast.order(n.title);
      if (n.type === 'low_stock' || n.type === 'void') toast.info(n.title);
    } else if (p.eventType === 'UPDATE') {
      setItems((list) => list.map((x) => (x.id === p.new.id ? p.new : x)));
    }
  });

  const isUnread = useCallback((n: AppNotification) => !n.read_by.includes(uid), [uid]);
  const unread = useMemo(() => items.filter(isUnread).length, [items, isUnread]);

  const markAllRead = useCallback(async () => {
    setItems((list) => list.map((n) => (n.read_by.includes(uid) ? n : { ...n, read_by: [...n.read_by, uid] })));
    await supabase.rpc('mark_notifications_read', {});
  }, [uid]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((list) => list.map((n) => (n.id === id && !n.read_by.includes(uid) ? { ...n, read_by: [...n.read_by, uid] } : n)));
      await supabase.rpc('mark_notifications_read', { p_ids: [id] });
    },
    [uid],
  );

  const value = useMemo(() => ({ items, unread, isUnread, markAllRead, markRead }), [items, unread, isUnread, markAllRead, markRead]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}
