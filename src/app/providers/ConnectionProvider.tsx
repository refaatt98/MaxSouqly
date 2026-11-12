import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/env';
import { countQueued, QUEUE_EVENT, syncQueue } from '@/lib/offlineQueue';
import { errorMessage } from '@/lib/errors';
import { placeOrder } from '@/features/pos/api';
import { useT } from '@/i18n';
import { useAuth } from './AuthProvider';
import { useSettings } from './SettingsProvider';
import { useToast } from './ToastProvider';

interface ConnectionContextValue {
  online: boolean;
  queueCount: number;
  syncing: boolean;
  syncNow: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const { status } = useAuth();
  const { settings } = useSettings();
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [realtimeOk, setRealtimeOk] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const wasOnline = useRef(true);
  const startupChecked = useRef(false);

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Heartbeat channel: supabase-js reconnects with backoff; its status drives the indicator.
  useEffect(() => {
    if (!isSupabaseConfigured || status !== 'signedIn') return;
    const channel = supabase.channel('max-heartbeat').subscribe((s) => {
      if (s === 'SUBSCRIBED') setRealtimeOk(true);
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setRealtimeOk(false);
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [status]);

  useEffect(() => {
    const refresh = () => void countQueued().then(setQueueCount);
    refresh();
    window.addEventListener(QUEUE_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_EVENT, refresh);
  }, []);

  const online = browserOnline && realtimeOk;

  const syncNow = useCallback(async () => {
    if (status !== 'signedIn') return;
    setSyncing(true);
    try {
      const res = await syncQueue(placeOrder);
      if (res.synced > 0) toast.success(t('offline.synced', { count: res.synced }));
      if (res.failed > 0) toast.error(t('offline.syncFailed', { error: errorMessage(t, res.lastError) }));
    } finally {
      setSyncing(false);
      setQueueCount(await countQueued());
    }
  }, [status, t, toast]);

  // Auto-sync when the connection comes back, and once on start if orders are waiting.
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (!online || status !== 'signedIn' || !(settings?.auto_sync ?? true)) return;
    if (cameBack || !startupChecked.current) {
      startupChecked.current = true;
      void countQueued().then((n) => {
        if (n > 0) void syncNowRef.current();
      });
    }
  }, [online, status, settings?.auto_sync]);

  const value = useMemo(() => ({ online, queueCount, syncing, syncNow }), [online, queueCount, syncing, syncNow]);
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used inside ConnectionProvider');
  return ctx;
}
