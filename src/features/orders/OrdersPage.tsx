import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Ban, ChefHat, ClipboardList, Download, Printer, RotateCcw, Undo2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { printKitchenTicket, printReceipt, receiptFromOrder } from '@/lib/print';
import { rangeToTimestamps, toISODate } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/app/providers/AuthProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { Drawer, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { fromJson, type Order, type OrderFull, type OrderStatus, type OrderType, type PaymentMethod } from '@/types/models';
import { paymentKind, STATUS_TONE } from './meta';

type OrderRow = Order & { cashier: { full_name: string } | null; payments: { method: PaymentMethod; amount: number }[] };

const PAGE = 50;
const STATUSES: OrderStatus[] = ['new', 'preparing', 'ready', 'served', 'cancelled', 'refunded'];
const TYPES: OrderType[] = ['dine_in', 'takeaway', 'delivery'];

interface Filters {
  from: string;
  to: string;
  status: string;
  type: string;
  cashier: string;
  payment: string;
}

function OrderDetails({ orderId, onClose, onChanged }: { orderId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { f, settings, name } = useSettings();
  const { role, profile } = useAuth();
  const toast = useToast();
  const [order, setOrder] = useState<OrderFull | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [voidMode, setVoidMode] = useState<'void' | 'refund' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isManager = role === 'owner' || role === 'manager';

  const load = useCallback(async () => {
    if (!orderId) return;
    setError(null);
    const { data, error: e } = await supabase.rpc('get_order', { p_order_id: orderId });
    if (e) setError(e);
    else setOrder(fromJson<OrderFull>(data));
  }, [orderId]);

  useEffect(() => {
    setOrder(null);
    void load();
  }, [load]);

  useRealtime(orderId ? { table: 'orders', event: 'UPDATE', filter: `id=eq.${orderId}` } : null, () => void load());

  const submitVoid = async () => {
    if (!order || !voidMode) return;
    if (reason.trim().length < 3) {
      setReasonError(t('errors.REASON_REQUIRED'));
      return;
    }
    setPending(true);
    try {
      const { data, error: e } = await supabase.rpc('void_order', { p_order_id: order.id, p_reason: reason.trim(), p_refund: voidMode === 'refund' });
      if (e) throw e;
      setOrder(fromJson<OrderFull>(data));
      toast.success(voidMode === 'refund' ? t('orders.refunded') : t('orders.voided'));
      setVoidMode(null);
      setReason('');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  const markServed = async () => {
    if (!order) return;
    setPending(true);
    const { error: e } = await supabase.rpc('advance_kitchen_status', { p_order_id: order.id, p_status: 'served' });
    setPending(false);
    if (e) toast.error(errorMessage(t, e));
    else {
      void load();
      onChanged();
    }
  };

  const timeline = order
    ? ([
        ['orders.timeline.created', order.created_at],
        ['orders.timeline.preparing', order.preparing_at],
        ['orders.timeline.ready', order.ready_at],
        ['orders.timeline.served', order.served_at],
        ['orders.timeline.voided', order.voided_at],
      ] as const).filter(([, at]) => at)
    : [];
  const voided = order?.status === 'cancelled' || order?.status === 'refunded';

  return (
    <Drawer
      open={orderId !== null}
      onClose={onClose}
      title={order ? t('orders.detailsTitle', { number: f.digits(order.order_number) }) : t('common.details')}
      footer={
        order && (
          <>
            <Button icon={<Printer className="size-4" />} onClick={() => void printReceipt(receiptFromOrder(order), { t, f, settings }, lang)}>
              {t('orders.reprint')}
            </Button>
            <Button variant="ghost" icon={<ChefHat className="size-4" />} onClick={() => void printKitchenTicket(receiptFromOrder(order), { t, f }, lang)}>
              {t('kitchen.ticket')}
            </Button>
            {order.status === 'ready' && (isManager || order.cashier_id === profile?.id) && (
              <Button variant="success" loading={pending} onClick={() => void markServed()}>
                {t('orders.markServed')}
              </Button>
            )}
            {isManager && !voided && (
              <div className="ms-auto flex gap-2">
                <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setVoidMode('void')}>
                  {t('orders.void')}
                </Button>
                <Button variant="outline" icon={<Undo2 className="size-4" />} onClick={() => setVoidMode('refund')}>
                  {t('orders.refund')}
                </Button>
              </div>
            )}
          </>
        )
      }
    >
      {error ? (
        <ErrorState message={errorMessage(t, error)} onRetry={() => void load()} retryLabel={t('common.retry')} />
      ) : !order ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[order.status]}>{t(`order.status.${order.status}`)}</Badge>
            <Badge>
              {t(`order.type.${order.type}`)}
              {order.table_no ? ` · ${t('order.table', { table: f.digits(order.table_no) })}` : ''}
            </Badge>
            <span className="text-sm text-fg-3">{f.dateTime(order.created_at)} · {order.cashier_name}</span>
          </div>
          {voided && order.void_reason && (
            <p className="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{t('orders.voidReason', { reason: order.void_reason })}</p>
          )}
          {order.type === 'delivery' && (
            <div className="rounded-card border border-line bg-card p-4 text-sm">
              <p className="mb-1 text-xs text-fg-3">{t('orders.customer')}</p>
              <p className="font-semibold">{order.customer_name} · <span dir="ltr">{order.customer_phone}</span></p>
              <p className="text-fg-2">{order.customer_address}</p>
            </div>
          )}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg-3">{t('orders.items')}</h3>
            <ul className="divide-y divide-line rounded-card border border-line bg-card">
              {order.items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-semibold">
                      <span className="num text-fg-3">{f.number(i.quantity)}×</span> {name({ name_ar: i.name_snapshot, name_he: i.name_he_snapshot })}
                    </p>
                    {i.notes && <p className="text-xs text-warning">• {i.notes}</p>}
                  </div>
                  <span className="num font-semibold">{f.money(Number(i.line_total))}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-fg-3">{t('pos.subtotal')}</dt><dd className="num">{f.money(Number(order.subtotal))}</dd></div>
              {Number(order.discount_amount) > 0 && (
                <div className="flex justify-between"><dt className="text-fg-3">{t('pos.discount')}</dt><dd className="num text-success">-{f.money(Number(order.discount_amount))}</dd></div>
              )}
              <div className="flex justify-between text-lg font-bold"><dt>{t('pos.grandTotal')}</dt><dd className="num">{f.money(Number(order.total))}</dd></div>
              <div className="flex justify-between text-xs text-fg-3"><dt>{t('pos.vatIncluded', { rate: f.number(Number(settings?.vat_percent ?? 0)) })}</dt><dd className="num">{f.money(Number(order.vat_amount))}</dd></div>
            </dl>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg-3">{t('orders.payments')}</h3>
            <ul className="space-y-1.5">
              {order.payments.map((p) => (
                <li key={p.id} className="flex justify-between rounded-btn bg-card px-3 py-2 text-sm">
                  <span>{t(`payment.${p.method}`)}{p.method === 'cash' && Number(p.change_given) > 0 ? ` · ${t('payment.changeDue')} ${f.money(Number(p.change_given))}` : ''}</span>
                  <span className="num font-semibold">{f.money(Number(p.amount))}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold text-fg-3">{t('orders.timeline')}</h3>
            <ol className="relative space-y-4 border-s border-line-strong ps-5">
              {timeline.map(([key, at]) => (
                <li key={key} className="relative">
                  <span className={`absolute -start-[27px] top-1 size-3 rounded-full ${key === 'orders.timeline.voided' ? 'bg-danger' : 'bg-brand'} shadow-glow-sm`} />
                  <p className="text-sm font-semibold">{t(key)}</p>
                  <p className="num text-xs text-fg-3">{f.dateTime(at as string)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      <Modal
        open={voidMode !== null}
        onClose={() => setVoidMode(null)}
        title={order ? t(voidMode === 'refund' ? 'orders.refundTitle' : 'orders.voidTitle', { number: f.digits(order.order_number) }) : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidMode(null)}>{t('common.back')}</Button>
            <Button variant="danger" loading={pending} onClick={() => void submitVoid()}>{t('common.confirm')}</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-fg-2">{voidMode === 'refund' ? t('orders.refundHint') : t('orders.voidHint')}</p>
        <Textarea label={t('orders.reason')} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(null); }} error={reasonError} required maxLength={300} data-autofocus />
      </Modal>
    </Drawer>
  );
}

export default function OrdersPage() {
  const { t } = useI18n();
  const { f } = useSettings();
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = toISODate(new Date());
  const [filters, setFilters] = useState<Filters>(() => ({
    from: today,
    to: today,
    status: params.get('active') ? 'active' : '',
    type: '',
    cashier: '',
    payment: '',
  }));
  const [limit, setLimit] = useState(PAGE);
  const selectedId = params.get('id');
  const isManager = role === 'owner' || role === 'manager';

  const fetchOrders = useCallback(async (): Promise<OrderRow[]> => {
    const { start, end } = rangeToTimestamps(filters.from, filters.to);
    const paymentsSel = filters.payment ? 'payments!inner(method, amount)' : 'payments(method, amount)';
    let q = supabase
      .from('orders')
      .select(`*, cashier:profiles!orders_cashier_id_fkey(full_name), ${paymentsSel}`)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (filters.status === 'active') q = q.in('status', ['new', 'preparing', 'ready']);
    else if (filters.status) q = q.eq('status', filters.status as OrderStatus);
    if (filters.type) q = q.eq('type', filters.type as OrderType);
    if (filters.cashier) q = q.eq('cashier_id', filters.cashier);
    if (filters.payment) q = q.eq('payments.method', filters.payment as PaymentMethod);
    const { data, error } = await q;
    if (error) throw error;
    return data as unknown as OrderRow[];
  }, [filters, limit]);

  const orders = useQuery(fetchOrders, [fetchOrders]);
  const cashiers = useQuery(
    async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').in('role', ['cashier', 'manager', 'owner']).order('full_name');
      if (error) throw error;
      return data;
    },
    [],
    { enabled: isManager },
  );

  const timer = useRef<number | undefined>(undefined);
  useRealtime({ table: 'orders' }, () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void orders.refetch(), 700);
  });

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setLimit(PAGE);
    setFilters((s) => ({ ...s, [k]: v }));
  };
  const openOrder = (id: string | null) => {
    if (id) params.set('id', id);
    else params.delete('id');
    params.delete('active');
    setParams(params, { replace: true });
  };

  const rows = orders.data ?? [];
  const total = rows.filter((o) => o.status !== 'cancelled' && o.status !== 'refunded').reduce((s, o) => s + Number(o.total), 0);

  const columns = useMemo<Column<OrderRow>[]>(
    () => [
      { key: 'num', header: t('orders.number'), cell: (o) => <span className="num font-bold">#{f.digits(o.order_number)}</span> },
      { key: 'time', header: t('orders.createdAt'), cell: (o) => <span className="num text-fg-2">{f.dateTime(o.created_at)}</span> },
      {
        key: 'type',
        header: t('orders.type'),
        cell: (o) => (
          <span>
            {t(`order.type.${o.type}`)}
            {o.table_no ? <span className="text-fg-3"> · {f.digits(o.table_no)}</span> : null}
          </span>
        ),
      },
      { key: 'cashier', header: t('orders.cashier'), cell: (o) => o.cashier?.full_name ?? t('common.none'), hideBelow: 'md' },
      {
        key: 'pay',
        header: t('orders.payment'),
        hideBelow: 'sm',
        cell: (o) => {
          const k = paymentKind(o.payments.map((p) => p.method));
          return k ? t(`payment.${k}`) : t('common.none');
        },
      },
      { key: 'status', header: t('common.status'), cell: (o) => <Badge tone={STATUS_TONE[o.status]}>{t(`order.status.${o.status}`)}</Badge> },
      { key: 'total', header: t('orders.total'), align: 'end', cell: (o) => <span className="num font-bold">{f.money(Number(o.total))}</span> },
    ],
    [t, f],
  );

  const exportCsv = () =>
    downloadCsv(
      `max-orders-${filters.from}_${filters.to}`,
      [t('orders.number'), t('common.date'), t('orders.type'), t('pos.tableNo'), t('orders.cashier'), t('orders.payment'), t('common.status'), t('pos.subtotal'), t('pos.discount'), t('orders.total')],
      rows.map((o) => [
        o.order_number,
        new Date(o.created_at).toLocaleString('en-GB'),
        t(`order.type.${o.type}`),
        o.table_no ?? '',
        o.cashier?.full_name ?? '',
        (() => {
          const k = paymentKind(o.payments.map((p) => p.method));
          return k ? t(`payment.${k}`) : '';
        })(),
        t(`order.status.${o.status}`),
        Number(o.subtotal),
        Number(o.discount_amount),
        Number(o.total),
      ]),
    );

  return (
    <div>
      <PageHeader
        title={t('orders.title')}
        icon={<ClipboardList className="size-6" />}
        subtitle={`${t('orders.count', { count: f.number(rows.length) })} · ${f.money(total)}`}
        actions={
          <>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => void orders.refetch()}>{t('common.refresh')}</Button>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={rows.length === 0}>{t('common.export')}</Button>
          </>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <TextInput type="date" label={t('common.from')} value={filters.from} max={filters.to} onChange={(e) => e.target.value && set('from', e.target.value)} />
          <TextInput type="date" label={t('common.to')} value={filters.to} min={filters.from} onChange={(e) => e.target.value && set('to', e.target.value)} />
          <Select
            label={t('common.status')}
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
            placeholder={t('orders.allStatuses')}
            options={[{ value: 'active', label: `${t('order.status.new')} / ${t('order.status.preparing')} / ${t('order.status.ready')}` }, ...STATUSES.map((s) => ({ value: s, label: t(`order.status.${s}`) }))]}
          />
          <Select label={t('orders.type')} value={filters.type} onChange={(e) => set('type', e.target.value)} placeholder={t('orders.allTypes')} options={TYPES.map((s) => ({ value: s, label: t(`order.type.${s}`) }))} />
          {isManager && (
            <Select
              label={t('orders.cashier')}
              value={filters.cashier}
              onChange={(e) => set('cashier', e.target.value)}
              placeholder={t('orders.allCashiers')}
              options={(cashiers.data ?? []).map((c) => ({ value: c.id, label: c.full_name }))}
            />
          )}
          <Select
            label={t('orders.payment')}
            value={filters.payment}
            onChange={(e) => set('payment', e.target.value)}
            placeholder={t('orders.allPayments')}
            options={[{ value: 'cash', label: t('payment.cash') }, { value: 'card', label: t('payment.card') }]}
          />
        </div>
      </Card>
      <Card className="overflow-hidden">
        {orders.error && !orders.data ? (
          <ErrorState message={errorMessage(t, orders.error)} onRetry={() => void orders.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            loading={orders.loading && !orders.data}
            onRowClick={(o) => openOrder(o.id)}
            rowClassName={(o) => (o.status === 'cancelled' || o.status === 'refunded' ? 'opacity-60' : undefined)}
            empty={<EmptyState icon={<ClipboardList className="size-7" />} title={t('orders.empty')} />}
          />
        )}
        {rows.length >= limit && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>{t('common.loadMore')}</Button>
          </div>
        )}
      </Card>
      <OrderDetails orderId={selectedId} onClose={() => openOrder(null)} onChanged={() => void orders.refetch()} />
    </div>
  );
}
