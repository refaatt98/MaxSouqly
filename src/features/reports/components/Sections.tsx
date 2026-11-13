import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { percentChange } from '@/lib/format';
import { rangeToTimestamps } from '@/lib/dates';
import { ORDER_COLS } from '@/lib/columns';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { ShareBars } from '@/components/ui/Chart';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Input';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fromJson, type Order, type OrderStatus, type OrderType, type PaymentMethod, type PaymentStatus, type PoStatus } from '@/types/models';
import { OrderDetails } from '@/features/orders/OrdersPage';
import { STATUS_TONE } from '@/features/orders/meta';
import type { RegisterExport } from './ReportTabs';
import { fetchTopItems } from '../api';
import { FoodImage } from '@/components/ui/FoodImage';

type Range = { from: string; to: string };
type Fn = 'report_orders' | 'report_payments' | 'report_tax' | 'report_purchases' | 'report_cash' | 'report_staff';

/** Same-length period right before [from, to]. */
export function previousRange(r: Range): Range {
  const a = new Date(`${r.from}T00:00:00`);
  const b = new Date(`${r.to}T00:00:00`);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const pe = new Date(a);
  pe.setDate(pe.getDate() - 1);
  const ps = new Date(pe);
  ps.setDate(ps.getDate() - (days - 1));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(ps), to: iso(pe) };
}

async function report<T>(fn: Fn, r: Range): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { p_from: r.from, p_to: r.to });
  if (error) throw error;
  return fromJson<T>(data);
}

/** Current and previous period of one report, kept live. */
function useReport<T>(fn: Fn, r: Range, tables: Parameters<typeof useLiveRefetch>[0]) {
  const cur = useQuery(() => report<T>(fn, r), [fn, r.from, r.to]);
  const prev = useQuery(() => report<T>(fn, previousRange(r)), [fn, r.from, r.to]);
  useLiveRefetch(tables, () => Promise.all([cur.refetch(), prev.refetch()]), 1500);
  return { cur, prev };
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-48 flex-1">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
      />
    </div>
  );
}

function Loading({ error, retry, children, ready }: { error: unknown; retry: () => void; children: ReactNode; ready: boolean }) {
  const { t } = useI18n();
  if (error && !ready) return <ErrorState message={errorMessage(t, error)} onRetry={retry} retryLabel={t('common.retry')} />;
  if (!ready) return <Skeleton className="h-72" />;
  return <>{children}</>;
}

const trend = (cur: number, prev: number | undefined) => (prev === undefined ? null : percentChange(cur, prev));

// ================================================================ order log (sales)
type LogRow = Pick<Order, 'id' | 'order_number' | 'type' | 'table_no' | 'status' | 'total' | 'discount_amount' | 'payment_status' | 'customer_name' | 'customer_phone' | 'created_at'> & {
  cashier: { full_name: string } | null;
  payments: { method: PaymentMethod; amount: number }[];
  items: { name_snapshot: string; quantity: number; voided_at: string | null }[];
};

/** Every order the cashiers recorded in the period; opening one shows its details. */
export function OrderLog({ range, register, title }: { range: Range; register?: RegisterExport; title?: string }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [pay, setPay] = useState('');
  const [cashier, setCashier] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const log = useQuery(async (): Promise<LogRow[]> => {
    const { start, end } = rangeToTimestamps(range.from, range.to);
    const { data, error } = await supabase
      .from('orders')
      .select(`${ORDER_COLS}, cashier:profiles!orders_cashier_id_fkey(full_name), payments(method, amount), items:order_items(name_snapshot, quantity, voided_at)`)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw error;
    return data as unknown as LogRow[];
  }, [range.from, range.to]);
  useLiveRefetch(['orders', 'payments', 'order_items'], log.refetch, 1500);

  const cashiers = useMemo(() => [...new Set((log.data ?? []).map((o) => o.cashier?.full_name).filter(Boolean) as string[])], [log.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/[^0-9]/g, '');
    return (log.data ?? []).filter((o) => {
      if (status && o.status !== status) return false;
      if (type && o.type !== type) return false;
      if (pay && o.payment_status !== pay && !o.payments.some((p) => p.method === pay)) return false;
      if (cashier && o.cashier?.full_name !== cashier) return false;
      if (!q) return true;
      return (
        String(o.order_number).includes(digits || q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (digits.length >= 3 && o.customer_phone.includes(digits)) ||
        o.items.some((i) => i.name_snapshot.toLowerCase().includes(q))
      );
    });
  }, [log.data, search, status, type, pay, cashier]);

  const itemsText = (o: LogRow) => o.items.filter((i) => !i.voided_at).map((i) => `${i.quantity}× ${i.name_snapshot}`).join('، ');
  const payText = (o: LogRow) => [...new Set(o.payments.filter((p) => Number(p.amount) > 0).map((p) => t(`payment.${p.method}`)))].join(' + ') || '—';

  useEffect(() => {
    if (!register) return;
    register({
      title: title ?? t('rep.orderLog'),
      sections: [
        {
          heading: t('rep.orderLog'),
          table: {
            headers: ['#', t('common.date'), t('orders.customer'), t('orders.itemsCol'), t('orders.type'), t('orders.cashier'), t('orders.payment'), t('common.status'), t('common.total')],
            rows: rows.map((o) => [o.order_number, f.dateTime(o.created_at), [o.customer_name, o.customer_phone].filter(Boolean).join(' '), itemsText(o), t(`order.type.${o.type}`), o.cashier?.full_name ?? '', `${payText(o)} · ${t(`payStatus.${o.payment_status}`)}`, t(`order.status.${o.status}`), f.money(Number(o.total))]),
          },
        },
      ],
      csv: {
        headers: ['#', t('common.date'), t('orders.customer'), t('common.phone'), t('orders.itemsCol'), t('orders.type'), t('orders.cashier'), t('orders.payment'), t('rep.payStatus'), t('common.status'), t('pos.discount'), t('common.total')],
        rows: rows.map((o) => [o.order_number, new Date(o.created_at).toLocaleString('en-GB'), o.customer_name, o.customer_phone, itemsText(o), t(`order.type.${o.type}`), o.cashier?.full_name ?? '', payText(o), t(`payStatus.${o.payment_status}`), t(`order.status.${o.status}`), Number(o.discount_amount), Number(o.total)]),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, register, title]);

  const columns: Column<LogRow>[] = [
    { key: 'n', header: '#', cell: (o) => <span className="num text-fg">#{f.digits(o.order_number)}</span> },
    { key: 'd', header: t('common.date'), cell: (o) => <span className="num text-fg-2">{f.dateTime(o.created_at)}</span> },
    { key: 'c', header: t('orders.customer'), hideBelow: 'md', cell: (o) => <span className="text-fg-2">{o.customer_name || o.customer_phone || '—'}</span> },
    { key: 'i', header: t('orders.itemsCol'), hideBelow: 'lg', cell: (o) => <span className="line-clamp-1 max-w-64 text-fg-2">{itemsText(o)}</span> },
    { key: 'k', header: t('orders.cashier'), hideBelow: 'md', cell: (o) => <span className="text-fg-2">{o.cashier?.full_name ?? '—'}</span> },
    { key: 'p', header: t('orders.payment'), hideBelow: 'sm', cell: (o) => <span className={o.payment_status !== 'paid' && o.status !== 'cancelled' && o.status !== 'refunded' ? 'text-warning' : 'text-fg-2'}>{o.payment_status === 'paid' ? payText(o) : t(`payStatus.${o.payment_status}`)}</span> },
    { key: 's', header: t('common.status'), cell: (o) => <Badge tone={STATUS_TONE[o.status]}>{t(`order.status.${o.status}`)}</Badge> },
    { key: 't', header: t('common.total'), align: 'end', cell: (o) => <span className={cn('num', o.status === 'cancelled' || o.status === 'refunded' ? 'text-fg-3 line-through' : 'text-fg')}>{f.money(Number(o.total))}</span> },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader title={title ?? t('rep.orderLog')} subtitle={t('rep.ordersFound', { count: f.number(rows.length) })} />
      <div className="flex flex-wrap items-center gap-2 p-4 pb-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t('rep.searchOrders')} />
        <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: t('rep.allStatuses') }, ...(['new', 'preparing', 'ready', 'served', 'cancelled', 'refunded'] as OrderStatus[]).map((s) => ({ value: s, label: t(`order.status.${s}`) }))]} />
        <Select aria-label={t('orders.type')} value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: t('orders.allTypes') }, ...(['dine_in', 'takeaway', 'delivery'] as OrderType[]).map((s) => ({ value: s, label: t(`order.type.${s}`) }))]} />
        <Select
          aria-label={t('orders.payment')}
          value={pay}
          onChange={(e) => setPay(e.target.value)}
          options={[
            { value: '', label: t('orders.allPayments') },
            { value: 'cash', label: t('payment.cash') },
            { value: 'card', label: t('payment.card') },
            ...(['paid', 'partial', 'unpaid'] as PaymentStatus[]).map((s) => ({ value: s, label: t(`payStatus.${s}`) })),
          ]}
        />
        {cashiers.length > 1 && (
          <Select aria-label={t('orders.cashier')} value={cashier} onChange={(e) => setCashier(e.target.value)} options={[{ value: '', label: t('orders.allCashiers') }, ...cashiers.map((c) => ({ value: c, label: c }))]} />
        )}
      </div>
      <Loading error={log.error} retry={() => void log.refetch()} ready={Boolean(log.data)}>
        <DataTable columns={columns} rows={rows.slice(0, 500)} rowKey={(o) => o.id} onRowClick={(o) => setOpen(o.id)} empty={<EmptyState icon={<Search className="size-6" />} title={t('orders.empty')} />} />
      </Loading>
      <OrderDetails orderId={open} onClose={() => setOpen(null)} onChanged={() => void log.refetch()} />
    </Card>
  );
}

// ================================================================ orders
interface OrdersRep {
  by_status: { status: OrderStatus; count: number; total: number }[];
  by_type: { type: OrderType; count: number; total: number }[];
  avg_ready_minutes: number | null;
  cancelled: number;
  cancelled_total: number;
  refunded: number;
  refunded_total: number;
  voided_items: number;
  voids: { id: string; order_number: number; total: number; status: OrderStatus; reason: string | null; at: string | null; by: string | null }[];
}

export function OrdersSection({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const { cur, prev } = useReport<OrdersRep>('report_orders', range, ['orders', 'order_items']);
  const d = cur.data;
  const count = (r?: OrdersRep) => (r?.by_status ?? []).filter((s) => s.status !== 'cancelled' && s.status !== 'refunded').reduce((a, s) => a + Number(s.count), 0);

  useEffect(() => {
    if (!d) return register(null);
    register({
      title: t('rep.orders'),
      sections: [
        { heading: t('rep.orders'), kpis: [[t('reports.ordersCount'), f.number(count(d))], [t('rep.cancelled'), f.number(d.cancelled)], [t('rep.refunded'), f.number(d.refunded)], [t('rep.avgReady'), d.avg_ready_minutes !== null ? `${f.number(Number(d.avg_ready_minutes), 1)} ${t('common.minutesShort')}` : '—']] },
        { heading: t('rep.byType'), table: { headers: [t('orders.type'), t('reports.ordersShort'), t('common.total')], rows: d.by_type.map((x) => [t(`order.type.${x.type}`), f.number(x.count), f.money(Number(x.total))]) } },
        { heading: t('rep.voidList'), table: { headers: ['#', t('common.status'), t('rep.reason'), t('rep.by'), t('common.total')], rows: d.voids.map((v) => [v.order_number, t(`order.status.${v.status}`), v.reason ?? '', v.by ?? '', f.money(Number(v.total))]) } },
      ],
      csv: { headers: ['#', t('common.status'), t('rep.reason'), t('rep.by'), t('common.total')], rows: d.voids.map((v) => [v.order_number, t(`order.status.${v.status}`), v.reason ?? '', v.by ?? '', Number(v.total)]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, register]);

  return (
    <Loading error={cur.error} retry={() => void cur.refetch()} ready={Boolean(d)}>
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard emphasis label={t('reports.ordersCount')} value={count(d)} format={(n) => f.number(Math.round(n))} trend={trend(count(d), prev.data ? count(prev.data) : undefined)} trendLabel={t('common.vsPrevious')} />
            <StatCard label={t('rep.cancelled')} value={d.cancelled} format={(n) => f.number(Math.round(n))} footer={<span className="num text-xs text-fg-3">{f.money(Number(d.cancelled_total))}</span>} />
            <StatCard label={t('rep.refunded')} value={d.refunded} format={(n) => f.number(Math.round(n))} footer={<span className="num text-xs text-fg-3">{f.money(Number(d.refunded_total))}</span>} />
            <StatCard label={t('rep.avgReady')} value={Number(d.avg_ready_minutes ?? 0)} format={(n) => `${f.number(n, 1)} ${t('common.minutesShort')}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('rep.byType')} />
              <div className="p-5">
                <ShareBars format={(n) => f.number(n)} items={d.by_type.map((x) => ({ label: t(`order.type.${x.type}`), value: Number(x.count) }))} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t('rep.byStatus')} />
              <div className="p-5">
                <ShareBars format={(n) => f.number(n)} items={d.by_status.map((x) => ({ label: t(`order.status.${x.status}`), value: Number(x.count) }))} />
              </div>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <CardHeader title={t('rep.voidList')} subtitle={t('rep.voidedItems', { count: f.number(d.voided_items) })} />
            <DataTable
              columns={[
                { key: 'n', header: '#', cell: (v) => <span className="num">#{f.digits(v.order_number)}</span> },
                { key: 's', header: t('common.status'), cell: (v) => <Badge tone={STATUS_TONE[v.status]}>{t(`order.status.${v.status}`)}</Badge> },
                { key: 'r', header: t('rep.reason'), cell: (v) => <span className="text-fg-2">{v.reason || '—'}</span> },
                { key: 'b', header: t('rep.by'), hideBelow: 'sm', cell: (v) => <span className="text-fg-2">{v.by ?? '—'}</span> },
                { key: 'a', header: t('common.date'), hideBelow: 'md', cell: (v) => <span className="num text-fg-3">{v.at ? f.dateTime(v.at) : '—'}</span> },
                { key: 't', header: t('common.total'), align: 'end', cell: (v) => <span className="num">{f.money(Number(v.total))}</span> },
              ]}
              rows={d.voids}
              rowKey={(v) => v.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('rep.noVoids')}</p>}
            />
          </Card>
        </div>
      )}
    </Loading>
  );
}

// ================================================================ sales: cancellations, returns, payment status
/** The parts of the sales report the sales summary does not show: cancellations, returns, unpaid. */
export function SalesExtras({ range }: { range: Range }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const orders = useReport<OrdersRep>('report_orders', range, ['orders']);
  const pays = useReport<PaymentsRep>('report_payments', range, ['payments']);
  const o = orders.cur.data;
  const p = pays.cur.data;
  const due = (p?.by_status ?? []).reduce((a, s) => a + Number(s.due), 0);
  const unpaid = (p?.by_status ?? []).filter((s) => s.status !== 'paid').reduce((a, s) => a + Number(s.count), 0);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard label={t('rep.cancelled')} value={Number(o?.cancelled ?? 0)} format={(n) => f.number(Math.round(n))} loading={!o} footer={o && <span className="num text-xs text-fg-3">{f.money(Number(o.cancelled_total))}</span>} />
      <StatCard label={t('rep.refunded')} value={Number(o?.refunded ?? 0)} format={(n) => f.number(Math.round(n))} loading={!o} footer={o && <span className="num text-xs text-fg-3">{f.money(Number(o.refunded_total))}</span>} />
      <StatCard label={t('rep.unpaidOrders')} value={unpaid} format={(n) => f.number(Math.round(n))} loading={!p} footer={p && <span className="num text-xs text-fg-3">{f.money(due)}</span>} />
      <StatCard label={t('rep.voidedItemsShort')} value={Number(o?.voided_items ?? 0)} format={(n) => f.number(Math.round(n))} loading={!o} />
    </div>
  );
}

// ================================================================ payments
interface PaymentsRep {
  by_method: { method: PaymentMethod; amount: number | null; count: number; refunds: number }[];
  by_status: { status: PaymentStatus; count: number; total: number; due: number }[];
  change_given: number;
  unpaid: { id: string; order_number: number; total: number; paid_amount: number; payment_status: PaymentStatus; customer_name: string; customer_phone: string; created_at: string }[];
}

export function PaymentsSection({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const { cur, prev } = useReport<PaymentsRep>('report_payments', range, ['payments', 'orders']);
  const d = cur.data;
  const total = (r?: PaymentsRep) => (r?.by_method ?? []).reduce((a, m) => a + Number(m.amount ?? 0), 0);
  const due = (d?.by_status ?? []).reduce((a, s) => a + Number(s.due), 0);
  const [search, setSearch] = useState('');
  const unpaid = (d?.unpaid ?? []).filter((u) => !search.trim() || String(u.order_number).includes(search.trim()) || u.customer_name.includes(search.trim()) || u.customer_phone.includes(search.trim()));

  useEffect(() => {
    if (!d) return register(null);
    register({
      title: t('rep.payments'),
      sections: [
        { heading: t('rep.payments'), kpis: [[t('rep.collected'), f.money(total(d))], [t('rep.outstanding'), f.money(due)], [t('rep.changeGiven'), f.money(Number(d.change_given))]] },
        { heading: t('reports.byPayment'), table: { headers: [t('orders.payment'), t('rep.count'), t('common.amount'), t('rep.refunds')], rows: d.by_method.map((m) => [t(`payment.${m.method}`), f.number(m.count), f.money(Number(m.amount ?? 0)), f.money(Number(m.refunds))]) } },
        { heading: t('rep.payStatus'), table: { headers: [t('common.status'), t('rep.count'), t('common.total'), t('rep.outstanding')], rows: d.by_status.map((s) => [t(`payStatus.${s.status}`), f.number(s.count), f.money(Number(s.total)), f.money(Number(s.due))]) } },
        { heading: t('rep.unpaidList'), table: { headers: ['#', t('orders.customer'), t('common.total'), t('rep.outstanding')], rows: d.unpaid.map((u) => [u.order_number, `${u.customer_name} ${u.customer_phone}`, f.money(Number(u.total)), f.money(Number(u.total) - Number(u.paid_amount))]) } },
      ],
      csv: { headers: [t('orders.payment'), t('rep.count'), t('common.amount'), t('rep.refunds')], rows: d.by_method.map((m) => [t(`payment.${m.method}`), m.count, Number(m.amount ?? 0), Number(m.refunds)]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, register]);

  return (
    <Loading error={cur.error} retry={() => void cur.refetch()} ready={Boolean(d)}>
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard emphasis label={t('rep.collected')} value={total(d)} format={f.money} trend={trend(total(d), prev.data ? total(prev.data) : undefined)} trendLabel={t('common.vsPrevious')} />
            {(['cash', 'card'] as PaymentMethod[]).map((m) => (
              <StatCard key={m} label={t(`payment.${m}`)} value={Number(d.by_method.find((x) => x.method === m)?.amount ?? 0)} format={f.money} />
            ))}
            <StatCard label={t('rep.outstanding')} value={due} format={f.money} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('reports.byPayment')} />
              <div className="p-5">
                <ShareBars format={f.money} items={d.by_method.map((m) => ({ label: t(`payment.${m.method}`), value: Number(m.amount ?? 0) }))} />
                <p className="num mt-4 text-xs text-fg-3">{t('rep.changeGiven')}: {f.money(Number(d.change_given))} · {t('rep.refunds')}: {f.money(d.by_method.reduce((a, m) => a + Number(m.refunds), 0))}</p>
              </div>
            </Card>
            <Card>
              <CardHeader title={t('rep.payStatus')} />
              <div className="p-5">
                <ShareBars format={(n) => f.number(n)} items={d.by_status.map((s) => ({ label: t(`payStatus.${s.status}`), value: Number(s.count) }))} />
              </div>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <CardHeader title={t('rep.unpaidList')} />
            <div className="p-4 pb-2">
              <SearchBox value={search} onChange={setSearch} placeholder={t('rep.searchOrders')} />
            </div>
            <DataTable
              columns={[
                { key: 'n', header: '#', cell: (u) => <span className="num">#{f.digits(u.order_number)}</span> },
                { key: 'c', header: t('orders.customer'), cell: (u) => <span className="text-fg-2">{u.customer_name || u.customer_phone || '—'}</span> },
                { key: 'd', header: t('common.date'), hideBelow: 'sm', cell: (u) => <span className="num text-fg-3">{f.dateTime(u.created_at)}</span> },
                { key: 's', header: t('common.status'), cell: (u) => <Badge tone={u.payment_status === 'partial' ? 'amber' : 'red'}>{t(`payStatus.${u.payment_status}`)}</Badge> },
                { key: 'r', header: t('rep.outstanding'), align: 'end', cell: (u) => <span className="num text-fg">{f.money(Number(u.total) - Number(u.paid_amount))}</span> },
              ]}
              rows={unpaid}
              rowKey={(u) => u.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('pos.unpaidEmpty')}</p>}
            />
          </Card>
        </div>
      )}
    </Loading>
  );
}

// ================================================================ taxes
interface TaxRep {
  rate: number;
  gross: number;
  vat: number;
  by_day: { date: string; gross: number; vat: number; orders: number }[];
}

export function TaxSection({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const { cur, prev } = useReport<TaxRep>('report_tax', range, ['orders']);
  const d = cur.data;
  const [search, setSearch] = useState('');
  const [min, setMin] = useState('');
  const days = (d?.by_day ?? []).filter((x) => (!search.trim() || f.date(x.date).includes(search.trim()) || x.date.includes(search.trim())) && (!min || Number(x.vat) >= Number(min)));
  useEffect(() => {
    if (!d) return register(null);
    register({
      title: t('rep.tax'),
      sections: [
        { heading: t('rep.tax'), kpis: [[t('rep.gross'), f.money(Number(d.gross))], [t('rep.vat', { rate: f.number(Number(d.rate)) }), f.money(Number(d.vat))], [t('rep.net'), f.money(Number(d.gross) - Number(d.vat))]] },
        { heading: t('rep.byDay'), table: { headers: [t('common.date'), t('reports.ordersShort'), t('rep.gross'), t('rep.vatShort'), t('rep.net')], rows: d.by_day.map((x) => [f.date(x.date), f.number(x.orders), f.money(Number(x.gross)), f.money(Number(x.vat)), f.money(Number(x.gross) - Number(x.vat))]) } },
      ],
      csv: { headers: [t('common.date'), t('reports.ordersShort'), t('rep.gross'), t('rep.vatShort'), t('rep.net')], rows: d.by_day.map((x) => [x.date, x.orders, Number(x.gross), Number(x.vat), Number(x.gross) - Number(x.vat)]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, register]);
  return (
    <Loading error={cur.error} retry={() => void cur.refetch()} ready={Boolean(d)}>
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <StatCard emphasis label={t('rep.vat', { rate: f.number(Number(d.rate)) })} value={Number(d.vat)} format={f.money} trend={trend(Number(d.vat), prev.data ? Number(prev.data.vat) : undefined)} trendLabel={t('common.vsPrevious')} />
            <StatCard label={t('rep.gross')} value={Number(d.gross)} format={f.money} />
            <StatCard label={t('rep.net')} value={Number(d.gross) - Number(d.vat)} format={f.money} />
          </div>
          <Card className="overflow-hidden">
            <CardHeader title={t('rep.byDay')} />
            <div className="flex flex-wrap gap-2 p-4 pb-2">
              <SearchBox value={search} onChange={setSearch} placeholder={t('rep.searchDate')} />
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                placeholder={t('rep.minVat')}
                aria-label={t('rep.minVat')}
                className="h-10 w-40 rounded-btn border border-line-strong bg-card px-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
              />
            </div>
            <DataTable
              columns={[
                { key: 'd', header: t('common.date'), cell: (x) => <span className="num">{f.date(x.date)}</span> },
                { key: 'o', header: t('reports.ordersShort'), hideBelow: 'sm', cell: (x) => <span className="num">{f.number(x.orders)}</span> },
                { key: 'g', header: t('rep.gross'), cell: (x) => <span className="num">{f.money(Number(x.gross))}</span> },
                { key: 'v', header: t('rep.vatShort'), cell: (x) => <span className="num text-fg">{f.money(Number(x.vat))}</span> },
                { key: 'n', header: t('rep.net'), align: 'end', cell: (x) => <span className="num">{f.money(Number(x.gross) - Number(x.vat))}</span> },
              ]}
              rows={days}
              rowKey={(x) => x.date}
              empty={<p className="p-5 text-sm text-fg-3">{t('common.noResults')}</p>}
            />
          </Card>
        </div>
      )}
    </Loading>
  );
}

// ================================================================ purchases & suppliers
interface PurchasesRep {
  costs_visible: boolean;
  by_supplier: { id: string; name: string; phone: string; orders: number; received: number; total: number | null }[];
  orders: { id: string; po_number: number; status: PoStatus; created_at: string; received_at: string | null; supplier: string | null; lines: number; total: number | null }[];
  materials: { name: string; unit: string; quantity: number; total: number | null }[];
}

export function PurchasesSection({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const { cur } = useReport<PurchasesRep>('report_purchases', range, ['purchase_orders', 'purchase_order_items']);
  const d = cur.data;
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const pos = (d?.orders ?? []).filter((p) => (!supplier || p.supplier === supplier) && (!search.trim() || String(p.po_number).includes(search.trim()) || (p.supplier ?? '').includes(search.trim())));
  const money = (n: number | null) => (n === null ? '—' : f.money(Number(n)));

  useEffect(() => {
    if (!d) return register(null);
    register({
      title: t('rep.purchases'),
      sections: [
        { heading: t('rep.bySupplier'), table: { headers: [t('po.supplier'), t('rep.count'), t('rep.received'), ...(d.costs_visible ? [t('common.total')] : [])], rows: d.by_supplier.map((s) => [s.name, f.number(s.orders), f.number(s.received), ...(d.costs_visible ? [money(s.total)] : [])]) } },
        { heading: t('rep.materialsIn'), table: { headers: [t('inventory.item'), t('common.quantity'), ...(d.costs_visible ? [t('common.total')] : [])], rows: d.materials.map((m) => [m.name, `${f.number(Number(m.quantity), 3)} ${t(`unit.${m.unit as 'kg'}`)}`, ...(d.costs_visible ? [money(m.total)] : [])]) } },
        { heading: t('rep.poList'), table: { headers: ['#', t('po.supplier'), t('common.date'), t('common.status'), ...(d.costs_visible ? [t('common.total')] : [])], rows: pos.map((p) => [p.po_number, p.supplier ?? '', f.date(p.created_at), t(`po.status.${p.status}`), ...(d.costs_visible ? [money(p.total)] : [])]) } },
      ],
      csv: { headers: ['#', t('po.supplier'), t('common.date'), t('common.status'), t('rep.lines'), ...(d.costs_visible ? [t('common.total')] : [])], rows: pos.map((p) => [p.po_number, p.supplier ?? '', p.created_at.slice(0, 10), t(`po.status.${p.status}`), p.lines, ...(d.costs_visible ? [Number(p.total ?? 0)] : [])]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, pos.length, register]);

  return (
    <Loading error={cur.error} retry={() => void cur.refetch()} ready={Boolean(d)}>
      {d && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader title={t('rep.bySupplier')} />
              <DataTable
                columns={[
                  { key: 'n', header: t('po.supplier'), cell: (s) => <span className="text-fg">{s.name}</span> },
                  { key: 'o', header: t('rep.count'), cell: (s) => <span className="num">{f.number(s.orders)}</span> },
                  { key: 'r', header: t('rep.received'), cell: (s) => <span className="num">{f.number(s.received)}</span> },
                  ...(d.costs_visible ? [{ key: 't', header: t('common.total'), align: 'end' as const, cell: (s: PurchasesRep['by_supplier'][number]) => <span className="num">{money(s.total)}</span> }] : []),
                ]}
                rows={d.by_supplier}
                rowKey={(s) => s.id}
                empty={<p className="p-5 text-sm text-fg-3">{t('common.noResults')}</p>}
              />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title={t('rep.materialsIn')} />
              <DataTable
                columns={[
                  { key: 'n', header: t('inventory.item'), cell: (m) => <span className="text-fg">{m.name}</span> },
                  { key: 'q', header: t('common.quantity'), cell: (m) => <span className="num">{f.number(Number(m.quantity), 3)} {t(`unit.${m.unit as 'kg'}`)}</span> },
                  ...(d.costs_visible ? [{ key: 't', header: t('common.total'), align: 'end' as const, cell: (m: PurchasesRep['materials'][number]) => <span className="num">{money(m.total)}</span> }] : []),
                ]}
                rows={d.materials}
                rowKey={(m) => m.name}
                empty={<p className="p-5 text-sm text-fg-3">{t('common.noResults')}</p>}
              />
            </Card>
          </div>
          <Card className="overflow-hidden">
            <CardHeader title={t('rep.poList')} />
            <div className="flex flex-wrap gap-2 p-4 pb-2">
              <SearchBox value={search} onChange={setSearch} placeholder={t('rep.searchPo')} />
              <Select aria-label={t('po.supplier')} value={supplier} onChange={(e) => setSupplier(e.target.value)} options={[{ value: '', label: t('rep.allSuppliers') }, ...d.by_supplier.map((s) => ({ value: s.name, label: s.name }))]} />
            </div>
            <DataTable
              columns={[
                { key: 'n', header: '#', cell: (p) => <span className="num">#{f.digits(p.po_number)}</span> },
                { key: 's', header: t('po.supplier'), cell: (p) => <span className="text-fg-2">{p.supplier ?? '—'}</span> },
                { key: 'd', header: t('common.date'), hideBelow: 'sm', cell: (p) => <span className="num text-fg-3">{f.date(p.received_at ?? p.created_at)}</span> },
                { key: 'st', header: t('common.status'), cell: (p) => <Badge tone={p.status === 'received' ? 'green' : p.status === 'cancelled' ? 'red' : 'neutral'}>{t(`po.status.${p.status}`)}</Badge> },
                ...(d.costs_visible ? [{ key: 't', header: t('common.total'), align: 'end' as const, cell: (p: PurchasesRep['orders'][number]) => <span className="num">{money(p.total)}</span> }] : []),
              ]}
              rows={pos}
              rowKey={(p) => p.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('po.empty')}</p>}
            />
          </Card>
        </div>
      )}
    </Loading>
  );
}

// ================================================================ cash drawer
interface CashRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  cashier: string | null;
  cash: number;
  card: number;
  advances: number;
  expected: number;
  counted: number | null;
  variance: number | null;
}

export function CashSection({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const { cur } = useReport<CashRow[]>('report_cash', range, ['cash_shifts', 'payments', 'salary_advances']);
  const rows = cur.data ?? [];
  const [cashier, setCashier] = useState('');
  const list = rows.filter((r) => !cashier || r.cashier === cashier);
  const sum = (k: 'cash' | 'card' | 'advances') => list.reduce((a, r) => a + Number(r[k]), 0);
  const variance = list.reduce((a, r) => a + Number(r.variance ?? 0), 0);

  useEffect(() => {
    if (!cur.data) return register(null);
    register({
      title: t('rep.cash'),
      sections: [
        { heading: t('rep.cash'), kpis: [[t('payment.cash'), f.money(sum('cash'))], [t('payment.card'), f.money(sum('card'))], [t('rep.advances'), f.money(sum('advances'))], [t('shift.variance'), f.money(variance)]] },
        { heading: t('act.shifts'), table: { headers: [t('orders.cashier'), t('common.from'), t('common.to'), t('shift.openingFloat'), t('payment.cash'), t('rep.advances'), t('shift.expectedCash'), t('shift.countedCash'), t('shift.variance')], rows: list.map((r) => [r.cashier ?? '', f.dateTime(r.opened_at), r.closed_at ? f.dateTime(r.closed_at) : t('act.open'), f.money(Number(r.opening_float)), f.money(Number(r.cash)), f.money(Number(r.advances)), f.money(Number(r.expected)), r.counted === null ? '—' : f.money(Number(r.counted)), r.variance === null ? '—' : f.money(Number(r.variance))]) } },
      ],
      csv: { headers: [t('orders.cashier'), t('common.from'), t('common.to'), t('shift.openingFloat'), t('payment.cash'), t('payment.card'), t('rep.advances'), t('shift.expectedCash'), t('shift.countedCash'), t('shift.variance')], rows: list.map((r) => [r.cashier ?? '', r.opened_at, r.closed_at ?? '', Number(r.opening_float), Number(r.cash), Number(r.card), Number(r.advances), Number(r.expected), r.counted ?? '', r.variance ?? '']) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.data, cashier, register]);

  const names = [...new Set(rows.map((r) => r.cashier).filter(Boolean) as string[])];
  return (
    <Loading error={cur.error} retry={() => void cur.refetch()} ready={Boolean(cur.data)}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard emphasis label={t('payment.cash')} value={sum('cash')} format={f.money} />
          <StatCard label={t('payment.card')} value={sum('card')} format={f.money} />
          <StatCard label={t('rep.advances')} value={sum('advances')} format={f.money} />
          <StatCard label={t('shift.variance')} value={variance} format={f.money} />
        </div>
        <Card className="overflow-hidden">
          <CardHeader title={t('act.shifts')} />
          {names.length > 1 && (
            <div className="p-4 pb-2">
              <Select aria-label={t('orders.cashier')} value={cashier} onChange={(e) => setCashier(e.target.value)} options={[{ value: '', label: t('orders.allCashiers') }, ...names.map((n) => ({ value: n, label: n }))]} />
            </div>
          )}
          <DataTable
            columns={[
              { key: 'c', header: t('orders.cashier'), cell: (r) => <span className="text-fg">{r.cashier ?? '—'}</span> },
              { key: 'o', header: t('common.from'), cell: (r) => <span className="num text-fg-2">{f.dateTime(r.opened_at)}</span> },
              { key: 'cash', header: t('payment.cash'), hideBelow: 'sm', cell: (r) => <span className="num">{f.money(Number(r.cash))}</span> },
              { key: 'a', header: t('rep.advances'), hideBelow: 'md', cell: (r) => <span className="num">{f.money(Number(r.advances))}</span> },
              { key: 'e', header: t('shift.expectedCash'), hideBelow: 'md', cell: (r) => <span className="num">{f.money(Number(r.expected))}</span> },
              { key: 'n', header: t('shift.countedCash'), hideBelow: 'sm', cell: (r) => <span className="num">{r.counted === null ? '—' : f.money(Number(r.counted))}</span> },
              { key: 'v', header: t('shift.variance'), align: 'end', cell: (r) => (r.variance === null ? <Badge tone="green" dot>{t('act.open')}</Badge> : <span className={cn('num', Math.abs(Number(r.variance)) >= 0.01 ? 'text-danger' : 'text-success')}>{f.money(Number(r.variance))}</span>) },
            ]}
            rows={list}
            rowKey={(r) => r.id}
            empty={<p className="p-5 text-sm text-fg-3">{t('act.shiftEmpty')}</p>}
          />
        </Card>
      </div>
    </Loading>
  );
}

// ================================================================ staff, wages & advances
interface StaffRep {
  employees: { id: string; name: string; position: string; salary_type: string; salary_amount: number; hours: number; days: number; absences: number; advances: number; payroll: number; paid: number }[];
  advances: { id: string; amount: number; note: string; created_at: string; employee: string; by: string | null }[];
}

export function StaffSection({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const { cur } = useReport<StaffRep>('report_staff', range, ['attendance', 'salary_advances', 'payroll']);
  const d = cur.data;
  const [search, setSearch] = useState('');
  const emps = (d?.employees ?? []).filter((e) => !search.trim() || e.name.includes(search.trim()) || e.position.includes(search.trim()));
  const wage = (e: StaffRep['employees'][number]) => `${f.money(Number(e.salary_amount))} / ${t(`employees.salary.${e.salary_type as 'daily'}`)}`;

  useEffect(() => {
    if (!d) return register(null);
    register({
      title: t('rep.staff'),
      sections: [
        { heading: t('rep.staff'), table: { headers: [t('common.name'), t('employees.salaryType'), t('employees.hours'), t('rep.days'), t('rep.absences'), t('rep.advances'), t('rep.payroll'), t('rep.paid')], rows: emps.map((e) => [e.name, wage(e), f.number(Number(e.hours), 1), f.number(e.days), f.number(e.absences), f.money(Number(e.advances)), f.money(Number(e.payroll)), f.money(Number(e.paid))]) } },
        { heading: t('rep.advancesList'), table: { headers: [t('common.date'), t('employees.shiftEmployee'), t('common.amount'), t('common.notes'), t('rep.by')], rows: d.advances.map((a) => [f.dateTime(a.created_at), a.employee, f.money(Number(a.amount)), a.note, a.by ?? '']) } },
      ],
      csv: { headers: [t('common.name'), t('employees.salaryType'), t('employees.salaryAmount'), t('employees.hours'), t('rep.days'), t('rep.absences'), t('rep.advances'), t('rep.payroll'), t('rep.paid')], rows: emps.map((e) => [e.name, t(`employees.salary.${e.salary_type as 'daily'}`), Number(e.salary_amount), Number(e.hours), e.days, e.absences, Number(e.advances), Number(e.payroll), Number(e.paid)]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, emps.length, register]);

  return (
    <Loading error={cur.error} retry={() => void cur.refetch()} ready={Boolean(d)}>
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard emphasis label={t('employees.hours')} value={emps.reduce((a, e) => a + Number(e.hours), 0)} format={(n) => f.number(n, 1)} />
            <StatCard label={t('rep.absences')} value={emps.reduce((a, e) => a + Number(e.absences), 0)} format={(n) => f.number(Math.round(n))} />
            <StatCard label={t('rep.advances')} value={emps.reduce((a, e) => a + Number(e.advances), 0)} format={f.money} />
            <StatCard label={t('rep.paid')} value={emps.reduce((a, e) => a + Number(e.paid), 0)} format={f.money} />
          </div>
          <Card className="overflow-hidden">
            <CardHeader title={t('rep.staff')} />
            <div className="p-4 pb-2">
              <SearchBox value={search} onChange={setSearch} placeholder={t('att.searchStaff')} />
            </div>
            <DataTable
              columns={[
                { key: 'n', header: t('common.name'), cell: (e) => <span className="text-fg">{e.name}</span> },
                { key: 'w', header: t('employees.salaryType'), hideBelow: 'md', cell: (e) => <span className="num text-fg-2">{wage(e)}</span> },
                { key: 'h', header: t('employees.hours'), cell: (e) => <span className="num">{f.number(Number(e.hours), 1)}</span> },
                { key: 'd', header: t('rep.days'), hideBelow: 'sm', cell: (e) => <span className="num">{f.number(e.days)}</span> },
                { key: 'ab', header: t('rep.absences'), hideBelow: 'sm', cell: (e) => <span className={cn('num', e.absences > 0 && 'text-warning')}>{f.number(e.absences)}</span> },
                { key: 'a', header: t('rep.advances'), hideBelow: 'md', cell: (e) => <span className="num">{f.money(Number(e.advances))}</span> },
                { key: 'p', header: t('rep.payroll'), align: 'end', cell: (e) => <span className="num">{f.money(Number(e.payroll))}</span> },
              ]}
              rows={emps}
              rowKey={(e) => e.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('common.noResults')}</p>}
            />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title={t('rep.advancesList')} />
            <DataTable
              columns={[
                { key: 'd', header: t('common.date'), cell: (a) => <span className="num text-fg-2">{f.dateTime(a.created_at)}</span> },
                { key: 'e', header: t('employees.shiftEmployee'), cell: (a) => <span className="text-fg">{a.employee}</span> },
                { key: 'n', header: t('common.notes'), hideBelow: 'sm', cell: (a) => <span className="text-fg-2">{a.note || '—'}</span> },
                { key: 'b', header: t('rep.by'), hideBelow: 'md', cell: (a) => <span className="text-fg-2">{a.by ?? '—'}</span> },
                { key: 'a', header: t('common.amount'), align: 'end', cell: (a) => <span className="num">{f.money(Number(a.amount))}</span> },
              ]}
              rows={d.advances}
              rowKey={(a) => a.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('rep.noAdvances')}</p>}
            />
          </Card>
        </div>
      )}
    </Loading>
  );
}


// ================================================================ sales: every item with its quantity
/** All items sold in the period with quantities and revenue (not only the top ten). */
export function ItemsSold({ range, register }: { range: Range; register: RegisterExport }) {
  const { t } = useI18n();
  const { f, name } = useSettings();
  const items = useQuery(() => fetchTopItems(range.from, range.to, 1000), [range.from, range.to]);
  useLiveRefetch(['orders', 'order_items'], items.refetch, 1500);
  const [search, setSearch] = useState('');
  const rows = (items.data ?? []).filter((i) => !search.trim() || i.name.includes(search.trim()) || i.name_he.includes(search.trim()));
  const totalQty = rows.reduce((a, i) => a + Number(i.qty), 0);
  useEffect(() => {
    if (!items.data) return register(null);
    register({
      title: t('rep.itemsSold'),
      sections: [{ heading: t('rep.itemsSold'), table: { headers: [t('inventory.item'), t('reports.sold'), t('reports.revenue')], rows: rows.map((i) => [i.name, f.number(Number(i.qty)), f.money(Number(i.revenue))]) } }],
      csv: { headers: [t('inventory.item'), t('reports.sold'), t('reports.revenue')], rows: rows.map((i) => [i.name, Number(i.qty), Number(i.revenue)]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data, search, register]);
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t('rep.itemsSold')} subtitle={t('rep.itemsSoldSub', { items: f.number(rows.length), qty: f.number(totalQty) })} />
      <div className="p-4 pb-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t('rep.searchItem')} />
      </div>
      <Loading error={items.error} retry={() => void items.refetch()} ready={Boolean(items.data)}>
        <DataTable
          columns={[
            {
              key: 'n',
              header: t('inventory.item'),
              cell: (i) => (
                <span className="flex items-center gap-3">
                  <FoodImage src={i.image_url} alt="" className="size-9 shrink-0 rounded-btn bg-elevated" />
                  <span className="text-fg">{name({ name_ar: i.name, name_he: i.name_he })}</span>
                </span>
              ),
            },
            { key: 'q', header: t('reports.sold'), cell: (i) => <span className="num">{f.number(Number(i.qty))}</span> },
            { key: 'r', header: t('reports.revenue'), align: 'end', cell: (i) => <span className="num text-fg">{f.money(Number(i.revenue))}</span> },
          ]}
          rows={rows}
          rowKey={(i) => i.menu_item_id ?? i.name}
          empty={<p className="p-5 text-sm text-fg-3">{t('common.noResults')}</p>}
        />
      </Loading>
    </Card>
  );
}
