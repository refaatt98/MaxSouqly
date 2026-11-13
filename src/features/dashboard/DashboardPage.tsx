import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Bell, ChartColumn, ClipboardList, Coins, MonitorSmartphone, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { isTranslationKey, useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { percentChange } from '@/lib/format';
import { parseISODate, satIndex, toISODate } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch, useRealtime } from '@/hooks/useRealtime';
import { useFormat } from '@/app/providers/SettingsProvider';
import { useNotifications } from '@/app/providers/NotificationsProvider';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { LineChart, RingGauge } from '@/components/ui/Chart';
import { Badge } from '@/components/ui/Badge';
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

interface DashboardExtra {
  expenses_today: number;
  unpaid_orders: number;
  printers: number;
  on_shift: { name: string; avatar_url: string | null; since: string }[];
  forgot_clock_out: number;
  activity: { action: string; entity: string; details: Record<string, unknown>; created_at: string; by: string | null }[];
}

async function fetchExtra(): Promise<DashboardExtra> {
  const { data, error } = await supabase.rpc('dashboard_extra');
  if (error) throw error;
  return fromJson<DashboardExtra>(data);
}

async function fetchTopToday(): Promise<{ name: string; qty: number; revenue: number }[]> {
  const today = toISODate(new Date());
  const { data, error } = await supabase.rpc('report_top_items', { p_from: today, p_to: today, p_limit: 5 });
  if (error) throw error;
  return fromJson(data);
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

function AlertRow({ tone, label, value, onClick }: { tone: 'amber' | 'red' | 'green' | 'neutral'; label: string; value: string; onClick: () => void }) {
  const dot = { amber: 'bg-warning', red: 'bg-danger', green: 'bg-success', neutral: 'bg-fg-3' }[tone];
  const txt = { amber: 'text-warning', red: 'text-danger', green: 'text-success', neutral: 'text-fg-2' }[tone];
  return (
    <li>
      <button type="button" onClick={onClick} className="flex h-11 w-full items-center gap-2.5 rounded-btn px-3 text-sm transition-colors hover:bg-fg/[0.04]">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        <span className="flex-1 text-start text-fg">{label}</span>
        <span className={`mono text-[0.8125rem] ${txt}`}>{value}</span>
      </button>
    </li>
  );
}

function QuickAction({ icon, label, count, onClick, to }: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
  to?: string;
  tone?: string;
}) {
  const inner = (
    <>
      <span className="text-fg-3">{icon}</span>
      <span className="flex-1 text-start text-sm text-fg">{label}</span>
      {count !== undefined && count > 0 && <span className="mono text-[0.8125rem] text-fg-2">{count}</span>}
    </>
  );
  const cls = 'flex h-12 items-center gap-2.5 rounded-btn px-3 transition-colors hover:bg-fg/[0.04]';
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
  const extra = useQuery(fetchExtra, []);
  const topToday = useQuery(fetchTopToday, []);
  useLiveRefetch(['orders', 'payments', 'expenses', 'attendance', 'audit_log', 'printers'], () => Promise.all([extra.refetch(), topToday.refetch()]), 1200);
  const x = extra.data;
  const actLabel = (prefix: string, key: string) => {
    const k = `${prefix}.${key}`;
    return isTranslationKey(k) ? t(k) : key;
  };

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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <StatCard
          label={t('dashboard.salesToday')}
          value={Number(d?.today.sales ?? 0)}
          format={money}
          icon={<Wallet className="size-6" />}
          tone="green"
          emphasis
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
        <StatCard label={t('dashboard.expensesToday')} value={Number(x?.expenses_today ?? 0)} format={money} loading={!x} delay={0.12} />
        <StatCard
          label={t('dashboard.currentOrders')}
          value={Number(d?.active_orders ?? 0)}
          format={(n) => f.number(Math.round(n), 0)}
          loading={dash.loading && !d}
          delay={0.14}
          footer={x && x.unpaid_orders > 0 ? <span className="text-xs text-warning">{t('dashboard.unpaidCount', { count: f.number(x.unpaid_orders) })}</span> : undefined}
        />
        <StatCard
          label={t('reports.avgTicket')}
          value={d && Number(d.today.orders) > 0 ? Number(d.today.sales) / Number(d.today.orders) : 0}
          format={f.money}
          loading={dash.loading && !d}
          delay={0.16}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title={t('dashboard.alerts')} icon={<Bell className="size-5" />} />
          <ul className="space-y-1 p-3">
            {d && d.low_stock_count > 0 && (
              <AlertRow tone="amber" label={t('dashboard.lowStock')} value={f.number(d.low_stock_count)} onClick={() => navigate('/inventory?low=1')} />
            )}
            {x && x.unpaid_orders > 0 && <AlertRow tone="amber" label={t('dashboard.unpaidOrders')} value={f.number(x.unpaid_orders)} onClick={() => navigate('/reports?tab=payments')} />}
            {d && d.active_orders > 0 && <AlertRow tone="green" label={t('dashboard.currentOrders')} value={f.number(d.active_orders)} onClick={() => navigate('/orders?active=1')} />}
            {x && x.forgot_clock_out > 0 && <AlertRow tone="red" label={t('dashboard.forgotClockOut')} value={f.number(x.forgot_clock_out)} onClick={() => navigate('/attendance')} />}
            {x && x.printers === 0 && <AlertRow tone="red" label={t('dashboard.noPrinters')} value="!" onClick={() => navigate('/settings?tab=printers')} />}
            {unread > 0 && <AlertRow tone="neutral" label={t('dashboard.unreadNotifications')} value={f.number(unread)} onClick={() => setAlertsOpen(true)} />}
            {x && d && d.low_stock_count === 0 && x.unpaid_orders === 0 && x.forgot_clock_out === 0 && x.printers > 0 && unread === 0 && d.active_orders === 0 && (
              <li className="px-3 py-6 text-center text-sm text-fg-3">{t('dashboard.allGood')}</li>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t('dashboard.topToday')} />
          <ul className="p-3">
            {(topToday.data ?? []).length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-fg-3">{t('dashboard.noOrdersYet')}</li>
            ) : (
              (topToday.data ?? []).map((i, n) => (
                <li key={i.name} className="flex items-center gap-3 rounded-btn px-3 py-2">
                  <span className="num w-5 text-fg-3">{f.digits(n + 1)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{i.name}</span>
                  <span className="num text-xs text-fg-3">×{f.number(Number(i.qty))}</span>
                  <span className="num w-20 text-end text-sm text-fg">{f.money(Number(i.revenue))}</span>
                </li>
              ))
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t('dashboard.staffActivity')} subtitle={x ? t('att.kioskSub', { count: f.number(x.on_shift.length) }) : undefined} />
          <div className="space-y-3 p-3">
            {x && x.on_shift.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {x.on_shift.map((s) => (
                  <Badge key={s.name + s.since} tone="green" dot>
                    {s.name} <span className="num text-fg-3">· {f.time(s.since)}</span>
                  </Badge>
                ))}
              </div>
            )}
            <ul className="divide-y divide-line">
              {(x?.activity ?? []).map((a, n) => (
                <li key={n} className="flex items-center gap-2 px-1 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-fg-2">
                    <span className="text-fg">{a.by ?? t('act.system')}</span> · {actLabel('act.action', a.action)} {actLabel('act.entity', a.entity)}
                    {typeof a.details.label === 'string' && a.details.label ? ` — ${a.details.label}` : ''}
                    {typeof a.details.order_number === 'number' ? ` #${f.digits(a.details.order_number)}` : ''}
                  </span>
                  <span className="num shrink-0 text-fg-3">{f.time(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('dashboard.weeklySales')}
            subtitle={t('dashboard.thisWeek')}
            icon={<TrendingUp className="size-5" />}
            actions={<span className="num text-lg font-medium text-fg">{f.money(Math.round(weekTotal))}</span>}
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
          className="relative overflow-hidden rounded-card border border-line bg-card p-6 xl:col-span-1"
        >
          <div className="flex h-full items-center gap-4">
            <div className="flex-1">
              <BrandMark size="lg" withSlogan />
              <Link
                to="/pos"
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-btn bg-brand px-4 text-sm font-medium text-white shadow-glow-sm transition-colors hover:bg-brand-hover"
              >
                <MonitorSmartphone className="size-4" /> {t('dashboard.heroCta')}
              </Link>
            </div>
            <img src="/images/login-burger.webp" alt="" className="w-36 shrink-0 drop-shadow-[0_16px_18px_rgba(0,0,0,0.45)] sm:w-48" />
          </div>
        </motion.div>

        <Card className="xl:col-span-1">
          <CardHeader title={t('dashboard.quickActions')} />
          <div className="space-y-0.5 p-2 pt-3">
            <QuickAction to="/orders?active=1" icon={<ClipboardList className="size-[1.125rem]" strokeWidth={1.5} />} label={t('dashboard.currentOrders')} count={d?.active_orders ?? 0} />
            <QuickAction onClick={() => setAlertsOpen(true)} icon={<Bell className="size-[1.125rem]" strokeWidth={1.5} />} label={t('dashboard.alerts')} count={unread} />
            <QuickAction to="/inventory?tab=purchases" icon={<ShoppingBag className="size-[1.125rem]" strokeWidth={1.5} />} label={t('dashboard.purchases')} count={d?.open_purchase_orders ?? 0} />
            <QuickAction to="/reports" icon={<ChartColumn className="size-[1.125rem]" strokeWidth={1.5} />} label={t('dashboard.quickReports')} />
          </div>
          {d && d.low_stock_count > 0 && (
            <button type="button" onClick={() => navigate('/inventory?low=1')} className="mx-2 mb-2 flex h-12 w-[calc(100%-1rem)] items-center gap-2.5 rounded-btn px-3 text-sm transition-colors hover:bg-fg/[0.04]">
              <span className="size-2 rounded-full bg-warning" aria-hidden />
              <span className="flex-1 text-start text-fg">{t('dashboard.lowStock')}</span>
              <span className="mono text-[0.8125rem] text-warning">{f.number(d.low_stock_count)}</span>
            </button>
          )}
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader title={t('dashboard.recentOrders')} actions={<Link to="/orders" className="text-[0.8125rem] text-fg-2 transition-colors hover:text-fg">{t('common.view')}</Link>} />
          <div className="p-3">
            {recent.loading && !recent.data ? (
              <div className="space-y-2 p-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : recent.data && recent.data.length > 0 ? (
              <ul>
                {recent.data.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders?id=${o.id}`} className="flex items-center gap-3 rounded-btn px-2 py-2.5 hover:bg-fg/[0.04]">
                      <span className="mono min-w-14 text-[0.8125rem] text-fg-2">#{f.digits(o.order_number)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-fg">{t(`order.type.${o.type}`)}{o.table_no ? ` · ${t('order.table', { table: f.digits(o.table_no) })}` : ''}</span>
                        <span className="block text-xs text-fg-3">{f.time(o.created_at)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[o.status]}>{t(`order.status.${o.status}`)}</Badge>
                      <span className="num w-20 text-end text-sm text-fg">{f.money(Number(o.total))}</span>
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
                  <span className="text-fg">{n.title}</span>
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
