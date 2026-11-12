import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Bell, ChartColumn, ClipboardList, Coins, MonitorSmartphone, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { percentChange } from '@/lib/format';
import { parseISODate, satIndex } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch, useRealtime } from '@/hooks/useRealtime';
import { useFormat } from '@/app/providers/SettingsProvider';
import { useNotifications } from '@/app/providers/NotificationsProvider';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { LineChart, RingGauge } from '@/components/ui/Chart';
import { CountBadge, Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState, EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { BrandMark } from '@/app/shell/BrandMark';
import { fromJson, type Order } from '@/types/models';
import { STATUS_TONE } from '@/features/orders/meta';

interface DayStats {
  sales: number;
  orders: number;
  profit: number;
}

interface DashboardData {
  today: DayStats;
  yesterday: DayStats;
  week: { date: string; sales: number | null; orders: number }[];
  active_orders: number;
  active_dine_in_tables: number;
  table_count: number;
  low_stock_count: number;
  unread_notifications: number;
  open_purchase_orders: number;
}

async function fetchDashboard(): Promise<DashboardData> {
  const { data, error } = await supabase.rpc('dashboard_today');
  if (error) throw error;
  return fromJson<DashboardData>(data);
}

type RecentOrder = Pick<Order, 'id' | 'order_number' | 'type' | 'status' | 'total' | 'created_at' | 'table_no'>;

async function fetchRecent(): Promise<RecentOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, type, status, total, created_at, table_no')
    .order('created_at', { ascending: false })
    .limit(6);
  if (error) throw error;
  return data;
}

function QuickAction({ icon, label, count, onClick, to, tone }: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
  to?: string;
  tone: string;
}) {
  const inner = (
    <>
      <span className={`grid size-12 place-items-center rounded-card ${tone}`}>{icon}</span>
      <span className="text-sm font-semibold">{label}</span>
      {count !== undefined && <CountBadge count={count} className="absolute end-3 top-3" />}
    </>
  );
  const cls =
    'relative flex flex-col items-center justify-center gap-3 rounded-card border border-line bg-card p-4 text-center transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card active:scale-[0.98] min-h-32';
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export default function DashboardPage() {
  const t = useT();
  const f = useFormat();
  const navigate = useNavigate();
  const { items: notifications, unread } = useNotifications();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const dash = useQuery(fetchDashboard, []);
  const recent = useQuery(fetchRecent, []);

  // Realtime: coalesce bursts of order changes into one refetch.
  const timer = useRef<number | undefined>(undefined);
  useRealtime({ table: 'orders' }, () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void dash.refetch();
      void recent.refetch();
    }, 800);
  });
  useRealtime({ table: 'ingredients', event: 'UPDATE' }, () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void dash.refetch(), 800);
  });

  useLiveRefetch(['expenses', 'purchase_orders', 'notifications'], dash.refetch, 800);

  const d = dash.data;
  const week = useMemo(
    () =>
      (d?.week ?? []).map((w) => {
        const date = parseISODate(w.date);
        return { label: t(`day.${satIndex(date)}` as 'day.0'), sublabel: f.date(date), value: w.sales === null ? null : Number(w.sales) };
      }),
    [d?.week, t, f],
  );
  const weekTotal = week.reduce((s, w) => s + (w.value ?? 0), 0);
  const occupancy = d && d.table_count > 0 ? (d.active_dine_in_tables / d.table_count) * 100 : 0;
  const money = (n: number) => f.money(Math.round(n));

  if (dash.error && !d) {
    return <ErrorState message={errorMessage(t, dash.error)} onRetry={() => void dash.refetch()} retryLabel={t('common.retry')} />;
  }

  return (
    <div className="space-y-5">
      <h1 className="sr-only">{t('dashboard.title')}</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={t('dashboard.salesToday')}
          value={Number(d?.today.sales ?? 0)}
          format={money}
          icon={<Wallet className="size-6" />}
          tone="green"
          loading={dash.loading && !d}
          trend={d ? percentChange(Number(d.today.sales), Number(d.yesterday.sales)) : null}
          trendLabel={t('common.vsYesterday')}
        />
        <StatCard
          label={t('dashboard.ordersToday')}
          value={Number(d?.today.orders ?? 0)}
          format={(n) => f.number(Math.round(n), 0)}
          icon={<ShoppingBag className="size-6" />}
          tone="blue"
          loading={dash.loading && !d}
          trend={d ? percentChange(Number(d.today.orders), Number(d.yesterday.orders)) : null}
          trendLabel={t('common.vsYesterday')}
          delay={0.05}
        />
        <StatCard
          label={t('dashboard.netProfit')}
          value={Number(d?.today.profit ?? 0)}
          format={money}
          icon={<Coins className="size-6" />}
          tone="gold"
          loading={dash.loading && !d}
          trend={d ? percentChange(Number(d.today.profit), Number(d.yesterday.profit)) : null}
          trendLabel={t('common.vsYesterday')}
          delay={0.1}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('dashboard.weeklySales')}
            subtitle={t('dashboard.thisWeek')}
            icon={<TrendingUp className="size-5" />}
            actions={<span className="num text-lg font-bold text-fg">{f.money(Math.round(weekTotal))}</span>}
          />
          <div className="px-3 pt-2 pb-3">
            {dash.loading && !d ? <Skeleton className="m-2 h-64" /> : <LineChart data={week} format={f.money} formatAxis={(n) => f.number(Math.round(n), 0)} height={270} />}
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title={t('dashboard.occupancy')} subtitle={d ? t('dashboard.occupancyHint', { active: f.number(d.active_dine_in_tables), total: f.number(d.table_count) }) : undefined} />
          <div className="grid flex-1 place-items-center py-6">
            {d ? <RingGauge value={occupancy} format={(n) => f.percent(n)} label={t('dashboard.occupancy')} size={200} /> : <Skeleton className="size-48 rounded-full" />}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Brand hero */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative overflow-hidden rounded-panel border border-line bg-gradient-to-l from-[#2a0a0e] via-surface to-surface p-6 shadow-panel xl:col-span-1"
        >
          <div className="absolute -start-8 top-0 h-full w-24 -skew-x-12 bg-brand/70" aria-hidden />
          <div className="absolute end-0 top-0 size-64 rounded-full bg-brand/25 blur-3xl" aria-hidden />
          <div className="relative flex h-full items-center gap-4">
            <div className="flex-1 ps-14">
              <BrandMark size="lg" withSlogan />
              <Link
                to="/pos"
                className="mt-5 inline-flex h-11 items-center gap-2 rounded-btn bg-brand px-4 text-sm font-semibold text-white shadow-glow-sm hover:bg-brand-hover"
              >
                <MonitorSmartphone className="size-4" /> {t('dashboard.heroCta')}
              </Link>
            </div>
            <img src="/images/hero-burger.svg" alt="" className="w-40 shrink-0 drop-shadow-[0_20px_30px_rgb(0_0_0/0.6)] sm:w-48" />
          </div>
        </motion.div>

        <Card className="xl:col-span-1">
          <CardHeader title={t('dashboard.quickActions')} />
          <div className="grid grid-cols-2 gap-3 p-5">
            <QuickAction to="/orders?active=1" icon={<ClipboardList className="size-6" />} label={t('dashboard.currentOrders')} count={d?.active_orders ?? 0} tone="bg-info/20 text-[#7aa5ff]" />
            <QuickAction onClick={() => setAlertsOpen(true)} icon={<Bell className="size-6" />} label={t('dashboard.alerts')} count={unread} tone="bg-brand/20 text-[#ff6b77]" />
            <QuickAction to="/inventory?tab=purchases" icon={<ShoppingBag className="size-6" />} label={t('dashboard.purchases')} count={d?.open_purchase_orders ?? 0} tone="bg-gold/15 text-gold" />
            <QuickAction to="/reports" icon={<ChartColumn className="size-6" />} label={t('dashboard.quickReports')} tone="bg-success/15 text-success" />
          </div>
          {d && d.low_stock_count > 0 && (
            <button type="button" onClick={() => navigate('/inventory?low=1')} className="mx-5 mb-5 flex w-[calc(100%-2.5rem)] items-center justify-between rounded-btn border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-semibold text-warning">
              <span>{t('dashboard.lowStock')}</span>
              <span className="num">{f.number(d.low_stock_count)}</span>
            </button>
          )}
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader title={t('dashboard.recentOrders')} actions={<Link to="/orders" className="text-xs font-semibold text-[#ff5a67] hover:underline">{t('common.view')}</Link>} />
          <div className="p-3">
            {recent.loading && !recent.data ? (
              <div className="space-y-2 p-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : recent.data && recent.data.length > 0 ? (
              <ul>
                {recent.data.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders?id=${o.id}`} className="flex items-center gap-3 rounded-btn px-2 py-2.5 hover:bg-white/[0.04]">
                      <span className="num grid h-10 min-w-14 place-items-center rounded-btn bg-white/5 px-2 text-sm font-bold">#{f.digits(o.order_number)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{t(`order.type.${o.type}`)}{o.table_no ? ` · ${t('order.table', { table: f.digits(o.table_no) })}` : ''}</span>
                        <span className="block text-xs text-fg-3">{f.time(o.created_at)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[o.status]}>{t(`order.status.${o.status}`)}</Badge>
                      <span className="num w-20 text-end text-sm font-bold">{f.money(Number(o.total))}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<ClipboardList className="size-7" />} title={t('dashboard.noOrdersYet')} />
            )}
          </div>
        </Card>
      </div>

      <Modal open={alertsOpen} onClose={() => setAlertsOpen(false)} title={t('dashboard.alerts')}>
        {notifications.length === 0 ? (
          <EmptyState icon={<Bell className="size-7" />} title={t('notifications.empty')} />
        ) : (
          <ul className="space-y-2">
            {notifications.slice(0, 15).map((n) => (
              <li key={n.id} className="rounded-card border border-line bg-card px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{n.title}</span>
                  <Badge tone={n.type === 'low_stock' ? 'amber' : n.type === 'void' ? 'red' : 'green'}>{t(`notifications.type.${n.type}`)}</Badge>
                </div>
                {n.body && <p className="mt-1 text-sm text-fg-3">{n.body}</p>}
                <p className="mt-1 text-xs text-fg-3">{f.dateTime(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
