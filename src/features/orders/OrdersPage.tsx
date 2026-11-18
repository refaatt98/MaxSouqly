import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Armchair, Ban, Bike, ChefHat, ClipboardList, Download, Pencil, Phone, Printer, RotateCcw, Search, ShoppingBag, Trash, Undo2, UserRound, UtensilsCrossed } from 'lucide-react';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { optionNames, printKitchenTicket, printReceipt, receiptFromOrder } from '@/lib/print';
import { ORDER_COLS } from '@/lib/columns';
import { PaymentModal, type PaymentResult } from '@/features/pos/components/PaymentModal';
import { addPayment } from '@/features/pos/api';
import { rangeToTimestamps, toISODate } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/app/providers/AuthProvider';
import { useFormat, useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useDeleteRecord, useDeleteMany } from '@/app/providers/DeleteProvider';
import { EditOrderModal, type EditableOrder } from './components/EditOrderModal';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { BulkBar, SelectBox, useSelection } from '@/components/ui/Table';
import { FoodImage } from '@/components/ui/FoodImage';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Tabs';
import { Drawer, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton';
import { fromJson, type Order, type OrderFull, type OrderStatus, type OrderType, type PaymentMethod } from '@/types/models';
import { paymentKind, STATUS_TONE } from './meta';

type OrderRow = Order & { cashier: { full_name: string } | null; payments: { method: PaymentMethod; amount: number }[] };

const PAGE = 50;
const TYPES: OrderType[] = ['dine_in', 'takeaway', 'delivery'];

interface Filters {
  from: string;
  to: string;
  status: string;
  type: string;
  cashier: string;
  payment: string;
}

export function OrderDetails({ orderId, onClose, onChanged }: { orderId: string | null; onClose: () => void; onChanged: () => void }) {
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
  const [editing, setEditing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const collect = async ({ payments }: PaymentResult) => {
    if (!order) return;
    setPending(true);
    try {
      const o = await addPayment(order.id, payments);
      setOrder(o);
      void printReceipt(receiptFromOrder(o), { t, f, settings }, lang);
      toast.success(t('pos.collected', { number: f.digits(o.order_number) }));
      setCollecting(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };
  const isManager = role === 'owner' || role === 'manager';
  const removeRecord = useDeleteRecord();

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
  const itemIds = [...new Set((order?.items ?? []).map((i) => i.menu_item_id).filter(Boolean) as string[])];
  const images = useQuery(
    async (): Promise<Record<string, string | null>> => {
      const { data, error: e } = await supabase.from('menu_items').select('id, image_url').in('id', itemIds);
      if (e) throw e;
      return Object.fromEntries(data.map((m) => [m.id, m.image_url]));
    },
    [itemIds.join(',')],
    { enabled: itemIds.length > 0 },
  );

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
            {!voided && order.payment_status !== 'paid' && (isManager || order.cashier_id === profile?.id) && (
              <Button variant="primary" onClick={() => setCollecting(true)}>
                {t('pos.collect')}
              </Button>
            )}
            {order.status === 'ready' && (isManager || order.cashier_id === profile?.id) && (
              <Button variant="success" loading={pending} onClick={() => void markServed()}>
                {t('orders.markServed')}
              </Button>
            )}
            {!voided && ['new', 'preparing', 'ready'].includes(order.status) && (isManager || order.cashier_id === profile?.id) && (
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t('orders.edit')}
              </Button>
            )}
            {isManager && (
              <Button
                variant="ghost"
                className="text-danger"
                icon={<Trash className="size-4" />}
                onClick={() =>
                  void removeRecord('order', order.id, `#${order.order_number}`).then((ok) => {
                    if (ok) {
                      onChanged();
                      onClose();
                    }
                  })
                }
              >
                {t('del.button')}
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
          {/* at a glance: number, where, when, who */}
          <div className="rounded-card border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="num text-[2rem] leading-none font-medium text-fg">#{f.digits(order.order_number)}</p>
                <p className="num mt-1.5 text-xs text-fg-3">{f.dateTime(order.created_at)} · {order.cashier_name}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={STATUS_TONE[order.status]}>{t(`order.status.${order.status}`)}</Badge>
                {!voided && (
                  <Badge tone={order.payment_status === 'paid' ? 'green' : order.payment_status === 'partial' ? 'amber' : 'red'}>
                    {t(`payStatus.${order.payment_status}`)}
                    {order.payment_status !== 'paid' && ` · ${f.money(Number(order.total) - Number(order.paid_amount))}`}
                  </Badge>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-btn bg-elevated px-3 py-2">
                <p className="text-xs text-fg-3">{order.type === 'dine_in' ? t('orders.table') : t('orders.type')}</p>
                <p className="num text-lg text-fg">
                  {order.type === 'dine_in' && order.table_no ? f.digits(order.table_no) : t(`order.type.${order.type}`)}
                </p>
              </div>
              <div className="rounded-btn bg-elevated px-3 py-2">
                <p className="text-xs text-fg-3">{t('orders.itemsCol')}</p>
                <p className="num text-lg text-fg">{f.number(order.items.filter((i) => !i.voided_at).reduce((a, i) => a + i.quantity, 0))}</p>
              </div>
            </div>
          </div>
          {voided && order.void_reason && (
            <p className="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{t('orders.voidReason', { reason: order.void_reason })}</p>
          )}
          {(order.customer_name || order.customer_phone || order.customer_address) && (
            <div className="rounded-card border border-line bg-card p-4 text-sm">
              <p className="mb-1 text-xs text-fg-3">{t('orders.customer')}</p>
              <p className="text-fg">{order.customer_name}</p>
              {order.customer_phone && (
                <a href={`tel:${order.customer_phone}`} className="mt-1 inline-flex items-center gap-1.5 text-fg-2 hover:text-fg" dir="ltr">
                  <Phone className="size-3.5" strokeWidth={1.5} /> {order.customer_phone}
                </a>
              )}
              {order.customer_address && <p className="mt-1 text-fg-2">{order.customer_address}</p>}
            </div>
          )}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg-3">{t('orders.items')}</h3>
            <ul className="divide-y divide-line rounded-card border border-line bg-card">
              {order.items.map((i) => (
                <li key={i.id} className={cn('flex items-start gap-3 px-4 py-3', i.voided_at && 'text-fg-3 opacity-70')}>
                  <FoodImage src={(i.menu_item_id && images.data?.[i.menu_item_id]) || null} alt="" className="size-14 shrink-0 rounded-btn bg-elevated" />
                  <div className="min-w-0 flex-1">
                    <p className={i.voided_at ? 'line-through' : 'text-fg'}>
                      <span className="num text-fg-3">{f.number(i.quantity)}×</span> {name({ name_ar: i.name_snapshot, name_he: i.name_he_snapshot })}
                    </p>
                    {optionNames(i.options).length > 0 && <p className="text-xs text-fg-2">+ {optionNames(i.options).join('، ')}</p>}
                    {i.notes && <p className="text-xs text-warning">• {i.notes}</p>}
                    {i.voided_at && <p className="text-xs">{t('edit.cancelledLine')}{i.void_reason ? ` — ${i.void_reason}` : ''}</p>}
                  </div>
                  <span className={cn('num', i.voided_at && 'line-through')}>{f.money(Number(i.line_total))}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-fg-3">{t('pos.subtotal')}</dt><dd className="num">{f.money(Number(order.subtotal))}</dd></div>
              {Number(order.discount_amount) > 0 && (
                <div className="flex justify-between"><dt className="text-fg-3">{t('pos.discount')}</dt><dd className="num text-success">-{f.money(Number(order.discount_amount))}</dd></div>
              )}
              <div className="flex justify-between text-lg font-semibold"><dt>{t('pos.grandTotal')}</dt><dd className="num">{f.money(Number(order.total))}</dd></div>
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
                  <span className={`absolute -start-[1.5625rem] top-1.5 size-2 rounded-full ${key === 'orders.timeline.voided' ? 'bg-danger' : 'bg-fg-3'}`} />
                  <p className="text-sm text-fg">{t(key)}</p>
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
      <PaymentModal
        open={collecting}
        due={order ? Math.round((Number(order.total) - Number(order.paid_amount)) * 100) / 100 : 0}
        onClose={() => setCollecting(false)}
        onConfirm={(r) => void collect(r)}
        pending={pending}
      />
      <EditOrderModal
        order={
          editing && order
            ? ({
                id: order.id,
                order_number: order.order_number,
                items: order.items.map((i) => ({
                  id: i.id,
                  menu_item_id: i.menu_item_id,
                  name: i.name_snapshot,
                  quantity: i.quantity,
                  unit_price: Number(i.unit_price_snapshot),
                  image_url: null,
                  notes: i.notes,
                  voided: Boolean(i.voided_at),
                })),
              } satisfies EditableOrder)
            : null
        }
        onClose={() => setEditing(false)}
        onChanged={(res) => {
          if (res) setOrder(res);
          else void load();
          onChanged();
        }}
      />
    </Drawer>
  );
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'custom';
type StatusChip = 'all' | 'active' | 'done' | 'void';

function presetDates(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return toISODate(d);
  };
  if (p === 'today') return { from: day(0), to: day(0) };
  if (p === 'yesterday') return { from: day(-1), to: day(-1) };
  return { from: day(p === '7d' ? -6 : -29), to: day(0) };
}

type ListRow = OrderRow & { items: { name_snapshot: string; quantity: number; voided_at: string | null; menu_item: { image_url: string | null } | null }[] };

/** Coloured edge per status, so a glance tells new / preparing / ready / done apart. */
const STATUS_EDGE: Record<OrderStatus, string> = {
  new: 'before:bg-brand',
  preparing: 'before:bg-warning',
  ready: 'before:bg-success',
  served: 'before:bg-fg-3/40',
  cancelled: 'before:bg-danger/50',
  refunded: 'before:bg-danger/50',
};

function OrderCard({ order: o, selected, onSelect, onOpen, payLabel }: {
  order: ListRow;
  selected: boolean;
  onSelect?: (on: boolean) => void;
  onOpen: () => void;
  payLabel: string;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const items = o.items.filter((i) => !i.voided_at);
  const count = items.reduce((a, i) => a + i.quantity, 0);
  const voided = o.status === 'cancelled' || o.status === 'refunded';
  const unpaid = !voided && o.payment_status !== 'paid';
  const where =
    o.staff_employee_id ? (
      <span className="inline-flex items-center gap-1.5 rounded-btn bg-warning/15 px-2.5 py-1 text-sm text-warning">
        <UtensilsCrossed className="size-4" /> {t('order.staffMeal')}
      </span>
    ) : o.type === 'dine_in' ? (
      <span className="inline-flex items-center gap-1.5 rounded-btn bg-elevated px-2.5 py-1 text-sm text-fg">
        <Armchair className="size-4 text-fg-3" /> {o.table_no ? t('order.table', { table: f.digits(o.table_no) }) : t('order.type.dine_in')}
      </span>
    ) : o.type === 'delivery' ? (
      <span className="inline-flex items-center gap-1.5 rounded-btn bg-elevated px-2.5 py-1 text-sm text-fg">
        <Bike className="size-4 text-fg-3" /> {t('order.type.delivery')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-btn bg-elevated px-2.5 py-1 text-sm text-fg">
        <ShoppingBag className="size-4 text-fg-3" /> {t('order.type.takeaway')}
      </span>
    );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'relative flex h-full cursor-pointer flex-col gap-3 overflow-hidden rounded-card border bg-card p-4 ps-5 text-start transition-colors',
        "before:absolute before:inset-y-0 before:start-0 before:w-1 before:content-['']",
        STATUS_EDGE[o.status],
        selected ? 'border-brand/60 bg-brand/[0.06]' : 'border-line hover:border-line-strong',
        voided && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="num text-[1.75rem] leading-none font-medium text-fg">#{f.digits(o.order_number)}</p>
          <p className="num mt-1 text-xs text-fg-3">
            {f.time(o.created_at)} · {o.cashier?.full_name ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[o.status]}>{t(`order.status.${o.status}`)}</Badge>
          {onSelect && (
            <span onClick={(e) => e.stopPropagation()}>
              <SelectBox checked={selected} onChange={onSelect} label={`${t('bulk.selectRow')} #${o.order_number}`} />
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {where}
        {(o.customer_name || o.customer_phone) && (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-btn border border-line px-2.5 py-1 text-sm">
            <UserRound className="size-4 shrink-0 text-fg-3" />
            {o.customer_name && <span className="truncate text-fg">{o.customer_name}</span>}
            {o.customer_phone && (
              <span className="num text-fg-2" dir="ltr">
                {o.customer_phone}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex -space-x-2 rtl:space-x-reverse">
          {items.slice(0, 4).map((i, k) => (
            <FoodImage key={k} src={i.menu_item?.image_url ?? null} alt="" className="size-10 rounded-full border-2 border-card bg-elevated object-cover" />
          ))}
        </div>
        <p className="line-clamp-2 min-w-0 flex-1 text-[0.8125rem] text-fg-2">
          {items.map((i) => `${i.quantity}× ${i.name_snapshot}`).join('، ')}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className={cn('text-xs', unpaid ? 'text-warning' : 'text-fg-3')}>
          {t('orders.itemsCount', { count: f.number(count) })} · {payLabel}
        </span>
        <span className={cn('num text-lg font-medium', voided ? 'text-fg-3 line-through' : 'text-fg')}>{f.money(Number(o.total))}</span>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { t } = useI18n();
  const { f } = useSettings();
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState(() => presetDates('today'));
  const range = preset === 'custom' ? custom : presetDates(preset);
  const [status, setStatus] = useState<StatusChip>(() => (params.get('active') ? 'active' : 'all'));
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);
  const [filters, setFilters] = useState<Pick<Filters, 'type' | 'cashier' | 'payment'>>({ type: '', cashier: '', payment: '' });
  const [limit, setLimit] = useState(PAGE);
  const selectedId = params.get('id');
  const isManager = role === 'owner' || role === 'manager';

  // search as you type (debounced)
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const fetchOrders = useCallback(async (): Promise<ListRow[]> => {
    const { start, end } = rangeToTimestamps(range.from, range.to);
    const paymentsSel = filters.payment ? 'payments!inner(method, amount)' : 'payments(method, amount)';
    let q = supabase
      .from('orders')
      .select(`${ORDER_COLS}, cashier:profiles!orders_cashier_id_fkey(full_name), ${paymentsSel}, items:order_items(name_snapshot, quantity, voided_at, menu_item:menu_items(image_url))`)
      .order('created_at', { ascending: false })
      .limit(limit);
    // a search looks across all dates
    if (query) {
      const digits = query.replace(/[^0-9]/g, '');
      const ors = [`customer_phone.ilike.%${query}%`, `customer_name.ilike.%${query}%`];
      if (digits && digits.length <= 7) ors.push(`order_number.eq.${digits}`);
      q = q.or(ors.join(','));
    } else {
      q = q.gte('created_at', start).lt('created_at', end);
    }
    if (filters.type) q = q.eq('type', filters.type as OrderType);
    if (filters.cashier) q = q.eq('cashier_id', filters.cashier);
    if (filters.payment) q = q.eq('payments.method', filters.payment as PaymentMethod);
    const { data, error } = await q;
    if (error) throw error;
    return data as unknown as ListRow[];
  }, [range.from, range.to, query, filters, limit]);

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

  const openOrder = (id: string | null) => {
    if (id) params.set('id', id);
    else params.delete('id');
    params.delete('active');
    setParams(params, { replace: true });
  };

  const all = orders.data ?? [];
  const isVoid = (o: OrderRow) => o.status === 'cancelled' || o.status === 'refunded';
  const isActive = (o: OrderRow) => ['new', 'preparing', 'ready'].includes(o.status);
  const counts = { all: all.length, active: all.filter(isActive).length, done: all.filter((o) => o.status === 'served').length, void: all.filter(isVoid).length };
  const rows = all.filter((o) => (status === 'all' ? true : status === 'active' ? isActive(o) : status === 'done' ? o.status === 'served' : isVoid(o)));
  const valid = all.filter((o) => !isVoid(o));
  const total = valid.reduce((s, o) => s + Number(o.total), 0);
  const itemsText = (o: ListRow) =>
    o.items
      .filter((i) => !i.voided_at)
      .map((i) => `${i.quantity}× ${i.name_snapshot}`)
      .join('، ');
  const payText = (o: OrderRow) => {
    if (!isVoid(o) && o.payment_status !== 'paid') return t(`payStatus.${o.payment_status}`);
    const k = paymentKind(o.payments.filter((p) => Number(p.amount) > 0).map((p) => p.method));
    return k ? t(`payment.${k}`) : t('common.none');
  };


  const exportCsv = () =>
    downloadCsv(
      `max-orders-${range.from}_${range.to}`,
      [t('orders.number'), t('common.date'), t('orders.customer'), t('common.phone'), t('orders.itemsCol'), t('orders.type'), t('pos.tableNo'), t('orders.cashier'), t('orders.payment'), t('common.status'), t('pos.discount'), t('orders.total')],
      rows.map((o) => [
        o.order_number,
        new Date(o.created_at).toLocaleString('en-GB'),
        o.customer_name,
        o.customer_phone,
        itemsText(o),
        t(`order.type.${o.type}`),
        o.table_no ?? '',
        o.cashier?.full_name ?? '',
        payText(o),
        t(`order.status.${o.status}`),
        Number(o.discount_amount),
        Number(o.total),
      ]),
    );

  const chips: { key: StatusChip; label: string }[] = [
    { key: 'all', label: t('common.all') },
    { key: 'active', label: t('orders.statusActive') },
    { key: 'done', label: t('orders.statusDone') },
    { key: 'void', label: t('orders.statusVoid') },
  ];

  const sel4 = useSelection((rows).map((x) => x.id));
  const removeMany4 = useDeleteMany();
  const bulkDelete4 = () =>
    void removeMany4('order', [...sel4.ids]).then((ok) => {
      if (ok) {
        sel4.clear();
        void orders.refetch();
      }
    });

  return (
    <div>
      <PageHeader
        title={t('orders.title')}
        actions={
          <>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => void orders.refetch()}>{t('common.refresh')}</Button>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={rows.length === 0}>{t('common.export')}</Button>
          </>
        }
      />

      {/* summary */}
      <div className={cn('mb-4 grid grid-cols-2 gap-3', isManager ? 'md:grid-cols-4' : 'md:grid-cols-2')}>
        {/* cashiers never see sales totals — only how many orders */}
        {(isManager
          ? [
              [t('reports.ordersCount'), f.number(valid.length)],
              [t('reports.totalSales'), f.money(total)],
              [t('reports.avgTicket'), f.money(valid.length ? total / valid.length : 0)],
              [t('orders.statusVoid'), f.number(counts.void)],
            ]
          : [
              [t('reports.ordersCount'), f.number(valid.length)],
              [t('orders.statusVoid'), f.number(counts.void)],
            ]
        ).map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-[0.8125rem] text-fg-2">{label}</p>
            <p className="num mt-1 text-[1.375rem] leading-tight font-medium text-fg">{value}</p>
          </Card>
        ))}
      </div>

      {/* search + dates */}
      <Card className="mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('orders.search')}
              aria-label={t('orders.search')}
              className="h-11 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
            />
          </div>
          <Segmented
            layoutId="ord-range"
            value={preset}
            onChange={(p) => {
              setPreset(p);
              setLimit(PAGE);
            }}
            items={[
              { key: 'today', label: t('reports.range.today') },
              { key: 'yesterday', label: t('orders.range.yesterday') },
              { key: '7d', label: t('reports.range.7d') },
              { key: '30d', label: t('reports.range.30d') },
              { key: 'custom', label: t('reports.range.custom') },
            ]}
          />
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <TextInput type="date" label={t('common.from')} value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
            <TextInput type="date" label={t('common.to')} value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatus(c.key)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-btn border px-3 text-sm transition-colors',
                status === c.key ? 'border-line-strong bg-elevated text-fg shadow-glow-sm' : 'border-line text-fg-2 hover:border-line-strong',
              )}
            >
              {status === c.key && <span className="slash" aria-hidden />}
              {c.label}
              <span className="num text-xs text-fg-3">{f.number(counts[c.key])}</span>
            </button>
          ))}
          <button type="button" onClick={() => setMore((m) => !m)} className="ms-auto text-sm text-fg-2 hover:text-fg">
            {t('orders.moreFilters')}
          </button>
        </div>
        {more && (
          <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
            <Select label={t('orders.type')} value={filters.type} onChange={(e) => setFilters((s) => ({ ...s, type: e.target.value }))} placeholder={t('orders.allTypes')} options={TYPES.map((x) => ({ value: x, label: t(`order.type.${x}`) }))} />
            {isManager && (
              <Select
                label={t('orders.cashier')}
                value={filters.cashier}
                onChange={(e) => setFilters((s) => ({ ...s, cashier: e.target.value }))}
                placeholder={t('orders.allCashiers')}
                options={(cashiers.data ?? []).map((c) => ({ value: c.id, label: c.full_name }))}
              />
            )}
            <Select
              label={t('orders.payment')}
              value={filters.payment}
              onChange={(e) => setFilters((s) => ({ ...s, payment: e.target.value }))}
              placeholder={t('orders.allPayments')}
              options={[{ value: 'cash', label: t('payment.cash') }, { value: 'card', label: t('payment.card') }]}
            />
          </div>
        )}
      </Card>

      {orders.error && !orders.data ? (
        <Card>
          <ErrorState message={errorMessage(t, orders.error)} onRetry={() => void orders.refetch()} retryLabel={t('common.retry')} />
        </Card>
      ) : orders.loading && !orders.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, k) => (
            <Skeleton key={k} className="h-56 rounded-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList className="size-6" />} title={t('orders.empty')} />
        </Card>
      ) : (
        <>
          {isManager && (
            <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-sm text-fg-2">
              <SelectBox
                checked={rows.every((o) => sel4.has(o.id))}
                indeterminate={rows.some((o) => sel4.has(o.id))}
                onChange={(on) => sel4.setAll(rows.map((o) => o.id), on)}
                label={t('bulk.selectAll')}
              />
              {t('bulk.selectAll')}
            </label>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((o) => (
              <li key={o.id}>
                <OrderCard
                  order={o}
                  selected={sel4.has(o.id)}
                  onSelect={isManager ? (on) => sel4.toggle(o.id, on) : undefined}
                  onOpen={() => openOrder(o.id)}
                  payLabel={payText(o)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {all.length >= limit && (
        <div className="mt-3 text-center">
          <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>{t('common.loadMore')}</Button>
        </div>
      )}
      {isManager && <BulkBar selection={sel4} onDelete={bulkDelete4} />}
      <OrderDetails orderId={selectedId} onClose={() => openOrder(null)} onChanged={() => void orders.refetch()} />
    </div>
  );
}
