import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Armchair, ArrowRight, Bike, ChefHat, LogOut, Maximize, Minimize, Printer, ShoppingBag, StickyNote, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { minutesSince } from '@/lib/dates';
import { audioUnlocked, playChime, unlockAudio } from '@/lib/sound';
import { printKitchenTicket } from '@/lib/print';
import { useNow } from '@/hooks/useNow';
import { useQuery } from '@/hooks/useQuery';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/app/providers/AuthProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { BrandMark } from '@/app/shell/BrandMark';
import { ConnectionPill, LiveClock } from '@/app/shell/TopBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/EmptyState';
import type { KitchenStatus } from '@/types/models';
import { advanceStatus, fetchActiveOrders, fetchKitchenOrder, nextStatus, prevStatus, type KitchenOrder } from './api';

const COLUMNS: { status: KitchenStatus; label: 'kitchen.new' | 'kitchen.preparing' | 'kitchen.ready'; header: string; ring: string }[] = [
  { status: 'new', label: 'kitchen.new', header: 'bg-brand', ring: '' },
  { status: 'preparing', label: 'kitchen.preparing', header: 'bg-warning', ring: '' },
  { status: 'ready', label: 'kitchen.ready', header: 'bg-success', ring: '' },
];

const LONG_PRESS_MS = 600;

function OrderCard({ order, now, fresh, onAdvance, onBack }: {
  order: KitchenOrder;
  now: number;
  fresh: boolean;
  onAdvance: () => void;
  onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const mins = minutesSince(order.created_at, now);
  const warn = settings?.kitchen_warn_minutes ?? 8;
  const late = settings?.kitchen_late_minutes ?? 15;
  const level = order.status === 'ready' ? 'ok' : mins >= late ? 'late' : mins >= warn ? 'warn' : 'ok';

  const start = () => {
    longPressed.current = false;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
      onBack();
    }, LONG_PRESS_MS);
  };
  const cancel = () => window.clearTimeout(timer.current);
  const click = () => {
    if (longPressed.current) return;
    onAdvance();
  };

  const TypeIcon = order.type === 'dine_in' ? Armchair : order.type === 'delivery' ? Bike : ShoppingBag;
  const actionLabel = order.status === 'new' ? t('kitchen.start') : order.status === 'preparing' ? t('kitchen.markReady') : t('kitchen.serve');

  return (
    <motion.article
      layout
      layoutId={order.id}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        // a printed thermal ticket on the rail
        'relative cursor-pointer touch-manipulation rounded-[4px] bg-paper px-4 pt-5 pb-4 text-paper-ink shadow-[0_10px_24px_-12px_rgb(0_0_0/0.8)] outline-2 outline-offset-2 outline-transparent select-none',
        'before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:rounded-t-[4px]',
        level === 'late' ? 'before:bg-danger' : level === 'warn' ? 'before:bg-warning' : 'before:bg-[#cfc6b6]',
        fresh && 'animate-pulse-red',
      )}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={click}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAdvance();
        } else if (e.key === 'Backspace') onBack();
      }}
      onContextMenu={(e) => e.preventDefault()}
      tabIndex={0}
      role="button"
      aria-label={`${t('order.number', { number: order.order_number })} — ${actionLabel}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="mono text-[30px] leading-none font-medium">#{f.digits(order.order_number)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[15px] text-paper-muted">
            <TypeIcon className="size-[18px]" strokeWidth={1.5} />
            {t(`order.type.${order.type}`)}
            {order.table_no ? ` · ${t('order.table', { table: f.digits(order.table_no) })}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={cn(
              'num rounded-[4px] px-2 py-0.5 text-[15px]',
              level === 'late' ? 'bg-danger text-white' : level === 'warn' ? 'bg-warning text-paper-ink' : 'text-paper-muted',
            )}
          >
            {t('common.ago', { value: `${f.number(mins)} ${t('common.minutesShort')}` })}
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void printKitchenTicket(
                {
                  number: `#${order.order_number}`,
                  created_at: order.created_at,
                  cashier_name: '',
                  type: order.type,
                  table_no: order.table_no,
                  notes: order.notes,
                  items: order.items.map((i) => ({ name: i.name_snapshot, qty: i.quantity, unit_price: 0, notes: i.notes })),
                  subtotal: 0,
                  discount_amount: 0,
                  total: 0,
                  vat_amount: 0,
                  payments: [],
                },
                { t, f },
                lang,
              );
            }}
            className="grid size-9 place-items-center rounded-[6px] text-paper-muted transition-colors hover:bg-black/5 hover:text-paper-ink"
            aria-label={t('kitchen.ticket')}
          >
            <Printer className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <ul className="mt-4 space-y-2.5 border-t-2 border-dashed border-paper-ink/20 pt-3">
        {order.items.map((i) => (
          <li key={i.id}>
            <div className="flex items-start gap-3 text-xl font-medium">
              <span className="mono grid h-8 min-w-8 place-items-center rounded-[4px] border border-paper-ink/25 px-1.5 text-lg">{f.number(i.quantity)}</span>
              <span className="pt-0.5">{lang === 'he' && i.name_he_snapshot ? i.name_he_snapshot : i.name_snapshot}</span>
            </div>
            {i.notes && <p className="ms-11 mt-1 border-s-2 border-danger ps-2 text-base font-medium text-[#b4242c]">{i.notes}</p>}
          </li>
        ))}
      </ul>
      {order.notes && (
        <p className="mt-3 flex items-start gap-2 border-t-2 border-dashed border-paper-ink/20 pt-3 text-sm text-paper-muted">
          <StickyNote className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} /> {order.notes}
        </p>
      )}
      <div className="mt-4 flex h-11 items-center justify-center gap-2 rounded-[6px] bg-paper-ink text-[15px] font-medium text-paper">
        {actionLabel}
        <ArrowRight className="size-[18px] rtl:-scale-x-100" strokeWidth={1.5} />
      </div>
    </motion.article>
  );
}

export default function KitchenPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { role, signOut } = useAuth();
  const { settings } = useSettings();
  const now = useNow(15_000);
  const orders = useQuery(fetchActiveOrders, []);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [soundOn, setSoundOn] = useState(true);
  const [soundReady, setSoundReady] = useState(audioUnlocked());
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const markFresh = useCallback((id: string) => {
    setFresh((s) => new Set(s).add(id));
    window.setTimeout(() => setFresh((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    }), 3000);
  }, []);

  const upsert = useCallback(
    (o: KitchenOrder) => {
      orders.setData((list = []) => {
        if (!['new', 'preparing', 'ready'].includes(o.status)) return list.filter((x) => x.id !== o.id);
        const exists = list.some((x) => x.id === o.id);
        const next = exists ? list.map((x) => (x.id === o.id ? o : x)) : [...list, o];
        return next.sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
    },
    [orders],
  );

  useRealtime({ table: 'orders' }, (p) => {
    if (p.eventType === 'INSERT') {
      const id = p.new.id;
      // items are committed in the same transaction as the order
      void fetchKitchenOrder(id).then((o) => {
        if (!o) return;
        upsert(o);
        markFresh(o.id);
        if (settings?.order_notifications ?? true) {
          toast.order(t('kitchen.newOrderToast', { number: o.order_number }));
          if (soundRef.current) playChime();
        }
      });
    } else if (p.eventType === 'UPDATE') {
      const row = p.new;
      orders.setData((list = []) => {
        if (!['new', 'preparing', 'ready'].includes(row.status)) return list.filter((x) => x.id !== row.id);
        if (!list.some((x) => x.id === row.id)) {
          void fetchKitchenOrder(row.id).then((o) => o && upsert(o));
          return list;
        }
        return list.map((x) => (x.id === row.id ? { ...x, status: row.status, preparing_at: row.preparing_at, ready_at: row.ready_at } : x));
      });
    } else if (p.eventType === 'DELETE') {
      const id = (p.old as { id?: string }).id;
      if (id) orders.setData((list = []) => list.filter((x) => x.id !== id));
    }
  });

  const move = async (order: KitchenOrder, to: KitchenStatus | null) => {
    if (!to) return;
    const snapshot = orders.data;
    // optimistic
    orders.setData((list = []) =>
      to === 'served' ? list.filter((x) => x.id !== order.id) : list.map((x) => (x.id === order.id ? { ...x, status: to } : x)),
    );
    try {
      await advanceStatus(order.id, to);
    } catch (err) {
      if (snapshot) orders.setData(snapshot);
      toast.error(errorMessage(t, err));
    }
  };

  const grouped = useMemo(() => {
    const g: Record<string, KitchenOrder[]> = { new: [], preparing: [], ready: [] };
    for (const o of orders.data ?? []) g[o.status]?.push(o);
    return g;
  }, [orders.data]);

  const enableSound = async () => {
    const ok = await unlockAudio();
    setSoundReady(ok);
    if (ok) {
      setSoundOn(true);
      playChime();
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="pattern flex h-dvh flex-col bg-bg">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <BrandMark />
        <h1 className="flex items-center gap-2 text-lg font-medium">
          <ChefHat className="size-5 text-fg-3" strokeWidth={1.5} /> {t('kitchen.title')}
        </h1>
        <span className="hidden text-sm text-fg-3 lg:block">{t('kitchen.tapHint')}</span>
        <div className="ms-auto flex items-center gap-2">
          <LiveClock className="text-2xl text-fg" />
          <ConnectionPill />
          {!soundReady ? (
            <button type="button" onClick={() => void enableSound()} className="h-10 rounded-btn bg-brand px-4 text-sm font-medium text-white shadow-glow-sm transition-colors hover:bg-brand-hover">
              {t('kitchen.enableSound')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSoundOn((v) => !v)}
              aria-pressed={soundOn}
              aria-label={t('kitchen.sound')}
              className="grid size-10 place-items-center rounded-btn border border-line text-fg-2 transition-colors hover:text-fg"
            >
              {soundOn ? <Volume2 className="size-[18px]" strokeWidth={1.5} /> : <VolumeX className="size-[18px]" strokeWidth={1.5} />}
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} aria-label={t('kitchen.fullscreen')} className="grid size-10 place-items-center rounded-btn border border-line text-fg-2 transition-colors hover:text-fg">
            {fullscreen ? <Minimize className="size-[18px]" strokeWidth={1.5} /> : <Maximize className="size-[18px]" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={() => (role === 'kitchen' ? void signOut() : navigate('/'))}
            aria-label={role === 'kitchen' ? t('nav.logout') : t('kitchen.exit')}
            className="grid size-10 place-items-center rounded-btn border border-line text-fg-2 transition-colors hover:text-fg"
          >
            <LogOut className="size-[18px] rtl:-scale-x-100" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {orders.error && !orders.data ? (
        <ErrorState message={errorMessage(t, orders.error)} onRetry={() => void orders.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <LayoutGroup>
          <div className="grid min-h-0 flex-1 gap-4 overflow-x-auto p-4 md:grid-cols-3">
            {COLUMNS.map((col) => (
              <section key={col.status} className="flex min-h-0 min-w-[300px] flex-col rounded-panel border border-line bg-surface" aria-label={t(col.label)}>
                <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
                  <span className={cn('size-2.5 rounded-full', col.header)} aria-hidden />
                  <span className="text-[15px] font-medium text-fg">{t(col.label)}</span>
                  <span className="mono ms-auto text-[15px] text-fg-2">{grouped[col.status].length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  {orders.loading && !orders.data ? (
                    Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-56 rounded-panel" />)
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {grouped[col.status].map((o) => (
                        <OrderCard key={o.id} order={o} now={now} fresh={fresh.has(o.id)} onAdvance={() => void move(o, nextStatus(o.status as KitchenStatus))} onBack={() => void move(o, prevStatus(o.status as KitchenStatus))} />
                      ))}
                    </AnimatePresence>
                  )}
                  {!orders.loading && grouped[col.status].length === 0 && <p className="py-16 text-center text-fg-3">{t('kitchen.empty')}</p>}
                </div>
              </section>
            ))}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
