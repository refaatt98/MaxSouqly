import { useEffect, useMemo, useState } from 'react';
import { Contact, MapPin, Pencil, Phone, Plus, Search, StickyNote, Trash } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useDeleteRecord, useDeleteMany } from '@/app/providers/DeleteProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Modal';
import { TextInput, Textarea } from '@/components/ui/Input';
import { DataTable, type Column, BulkBar, useSelection } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import type { Customer, Order } from '@/types/models';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Avatar';
import { FoodImage } from '@/components/ui/FoodImage';
import { OrderDetails } from '@/features/orders/OrdersPage';
import { STATUS_TONE } from '@/features/orders/meta';

type HistoryRow = Pick<Order, 'id' | 'order_number' | 'type' | 'status' | 'total' | 'created_at' | 'payment_status'> & {
  table_no: number | null;
  items: { name_snapshot: string; quantity: number; voided_at: string | null; menu_item: { image_url: string | null } | null }[];
};

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from('customers').select('*').order('last_order_at', { ascending: false, nullsFirst: false }).limit(2000);
  if (error) throw error;
  return data;
}

function CustomerDrawer({ customer, onClose, onChanged }: { customer: Customer | 'new' | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const removeRecord = useDeleteRecord();
  const editing = customer && customer !== 'new' ? customer : null;
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });
  const [pending, setPending] = useState(false);
  const history = useQuery(
    async (): Promise<HistoryRow[]> => {
      if (!editing) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, type, table_no, status, total, created_at, payment_status, items:order_items(name_snapshot, quantity, voided_at, menu_item:menu_items(image_url))')
        .eq('customer_id', editing.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    [editing?.id],
    { enabled: editing !== null },
  );

  useEffect(() => {
    if (customer === null) return;
    setForm({ name: editing?.name ?? '', phone: editing?.phone ?? '', address: editing?.address ?? '', notes: editing?.notes ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  const favorites = useMemo(() => {
    const m = new Map<string, { qty: number; image: string | null }>();
    for (const o of history.data ?? []) {
      if (o.status === 'cancelled' || o.status === 'refunded') continue;
      for (const i of o.items) {
        if (i.voided_at) continue;
        const cur = m.get(i.name_snapshot);
        m.set(i.name_snapshot, { qty: (cur?.qty ?? 0) + i.quantity, image: cur?.image ?? i.menu_item?.image_url ?? null });
      }
    }
    return [...m.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 6);
  }, [history.data]);
  const [editingInfo, setEditingInfo] = useState(false);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  useEffect(() => setEditingInfo(customer === 'new'), [customer]);

  const save = async () => {
    const phone = form.phone.replace(/[^0-9+]/g, '');
    if (!/^[0-9+]{7,20}$/.test(phone)) return toast.error(t('validation.phone'));
    setPending(true);
    const row = { name: form.name.trim(), phone, address: form.address.trim(), notes: form.notes.trim() };
    const { error } = editing ? await supabase.from('customers').update(row).eq('id', editing.id) : await supabase.from('customers').insert(row);
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('common.saved'));
    onChanged();
    onClose();
  };

  const remove = async () => {
    if (!editing) return;
    if (await removeRecord('customer', editing.id, editing.name || editing.phone)) {
      onChanged();
      onClose();
    }
  };

  return (
    <Drawer
      open={customer !== null}
      onClose={onClose}
      title={editing ? editing.name || editing.phone : t('cust.new')}
      footer={
        <>
          {editing && (
            <Button variant="ghost" className="me-auto hover:text-danger" icon={<Trash className="size-4" />} onClick={() => void remove()}>
              {t('del.button')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* profile */}
        {editing && !editingInfo && (
          <div className="rounded-card border border-line bg-card p-4">
            <div className="flex items-center gap-3">
              <Avatar name={editing.name || editing.phone} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg text-fg">{editing.name || t('common.unknown')}</p>
                <a href={`tel:${editing.phone}`} className="num inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg" dir="ltr">
                  <Phone className="size-3.5" /> {editing.phone}
                </a>
              </div>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditingInfo(true)}>
                {t('common.edit')}
              </Button>
            </div>
            {(editing.address || editing.notes) && (
              <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
                {editing.address && (
                  <p className="flex items-start gap-2 text-fg-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-fg-3" /> {editing.address}
                  </p>
                )}
                {editing.notes && (
                  <p className="flex items-start gap-2 text-warning">
                    <StickyNote className="mt-0.5 size-4 shrink-0" /> {editing.notes}
                  </p>
                )}
              </div>
            )}
            <p className="num mt-3 text-xs text-fg-3">
              {t('cust.since', { date: f.date(editing.created_at) })}
              {editing.last_order_at && ` · ${t('cust.lastShort', { date: f.date(editing.last_order_at) })}`}
            </p>
          </div>
        )}
        {editingInfo && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label={t('common.name')} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextInput label={t('common.phone')} type="tel" dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <TextInput className="sm:col-span-2" label={t('pos.customerAddress')} value={form.address} maxLength={300} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Textarea className="sm:col-span-2" label={t('cust.notes')} hint={t('cust.notesHint')} value={form.notes} maxLength={500} rows={2} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        )}
        {editing && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [t('cust.orders'), f.number(editing.orders_count)],
                [t('cust.spent'), f.money(Number(editing.total_spent))],
                [t('cust.avg'), f.money(editing.orders_count ? Number(editing.total_spent) / editing.orders_count : 0)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-card border border-line bg-card p-3">
                  <p className="text-xs text-fg-3">{l}</p>
                  <p className="num mt-0.5 text-lg text-fg">{v}</p>
                </div>
              ))}
            </div>
            {favorites.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm text-fg-3">{t('cust.favorites')}</h3>
                <div className="grid grid-cols-3 gap-2">
                  {favorites.map(([n, v]) => (
                    <div key={n} className="overflow-hidden rounded-card border border-line bg-card">
                      <FoodImage src={v.image} alt="" className="aspect-[4/3] w-full bg-elevated" />
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <span className="truncate text-xs text-fg">{n}</span>
                        <span className="num shrink-0 text-xs text-fg-3">×{f.number(v.qty)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3 className="mb-2 text-sm text-fg-3">{t('cust.history')}</h3>
              {history.loading && !history.data ? (
                <SkeletonRows rows={4} />
              ) : (history.data ?? []).length === 0 ? (
                <p className="text-sm text-fg-3">{t('orders.empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {(history.data ?? []).map((o) => {
                    const voided = o.status === 'cancelled' || o.status === 'refunded';
                    const items = o.items.filter((i) => !i.voided_at);
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setOpenOrder(o.id)}
                          className={cn('w-full rounded-card border border-line bg-card p-3 text-start transition-colors hover:border-line-strong', voided && 'opacity-60')}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="num text-lg text-fg">#{f.digits(o.order_number)}</span>
                            <Badge tone={STATUS_TONE[o.status]}>{t(`order.status.${o.status}`)}</Badge>
                          </div>
                          <p className="num mt-0.5 text-xs text-fg-3">
                            {f.dateTime(o.created_at)} · {o.type === 'dine_in' && o.table_no ? t('order.table', { table: f.digits(o.table_no) }) : t(`order.type.${o.type}`)}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex -space-x-2 rtl:space-x-reverse">
                              {items.slice(0, 4).map((i, k) => (
                                <FoodImage key={k} src={i.menu_item?.image_url ?? null} alt="" className="size-9 rounded-full border-2 border-card bg-elevated" />
                              ))}
                            </div>
                            <p className="line-clamp-1 min-w-0 flex-1 text-xs text-fg-2">{items.map((i) => `${i.quantity}× ${i.name_snapshot}`).join('، ')}</p>
                            <span className={cn('num text-sm', voided ? 'text-fg-3 line-through' : 'text-fg')}>{f.money(Number(o.total))}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      <OrderDetails orderId={openOrder} onClose={() => setOpenOrder(null)} onChanged={() => void history.refetch()} />
    </Drawer>
  );
}

export default function CustomersPage() {
  const t = useT();
  const { f } = useSettings();
  const list = useQuery(fetchCustomers, []);
  useLiveRefetch(['customers'], list.refetch, 1000);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Customer | 'new' | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/[^0-9]/g, '');
    return (list.data ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (digits.length >= 2 && c.phone.includes(digits)) || c.address.toLowerCase().includes(q),
    );
  }, [list.data, search]);

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={c.name || c.phone} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-fg">{c.name || t('common.unknown')}</p>
            {c.notes && <p className="truncate text-xs text-warning">{c.notes}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      header: t('common.phone'),
      cell: (c) => (
        <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="num inline-flex items-center gap-1.5 text-fg-2 hover:text-fg" dir="ltr">
          <Phone className="size-3.5" /> {c.phone}
        </a>
      ),
    },
    { key: 'address', header: t('pos.customerAddress'), hideBelow: 'lg', cell: (c) => <span className="line-clamp-1 text-fg-2">{c.address || '—'}</span> },
    { key: 'orders', header: t('cust.orders'), align: 'end', cell: (c) => <span className="num">{f.number(c.orders_count)}</span> },
    { key: 'spent', header: t('cust.spent'), align: 'end', hideBelow: 'sm', cell: (c) => <span className="num">{f.money(Number(c.total_spent))}</span> },
    { key: 'last', header: t('cust.last'), hideBelow: 'md', cell: (c) => <span className="num text-fg-3">{c.last_order_at ? f.date(c.last_order_at) : '—'}</span> },
  ];

  const sel5 = useSelection((rows).map((x) => x.id));
  const removeMany5 = useDeleteMany();
  const bulkDelete5 = () =>
    void removeMany5('customer', [...sel5.ids]).then((ok) => {
      if (ok) {
        sel5.clear();
        void list.refetch();
      }
    });

  return (
    <div>
      <PageHeader
        title={t('nav.customers')}
        subtitle={t('cust.count', { count: f.number(list.data?.length ?? 0) })}
        icon={<Contact className="size-6" />}
        actions={
          <>
            <Button
              onClick={() =>
                downloadCsv(
                  'max-customers',
                  [t('common.name'), t('common.phone'), t('pos.customerAddress'), t('cust.orders'), t('cust.spent'), t('cust.last'), t('cust.notes')],
                  rows.map((c) => [c.name, c.phone, c.address, c.orders_count, Number(c.total_spent), c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('en-GB') : '', c.notes]),
                )
              }
            >
              {t('common.export')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('new')}>
              {t('cust.new')}
            </Button>
          </>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('cust.search')}
          aria-label={t('cust.search')}
          className="h-11 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
        />
      </div>
      <Card className="overflow-hidden">
        {list.error && !list.data ? (
          <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <DataTable selection={sel5}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            loading={list.loading && !list.data}
            onRowClick={setOpen}
            empty={<EmptyState icon={<Contact className="size-6" />} title={t('cust.empty')} />}
          />
        )}
      </Card>
      <BulkBar selection={sel5} onDelete={bulkDelete5} />
      <CustomerDrawer customer={open} onClose={() => setOpen(null)} onChanged={() => void list.refetch()} />
    </div>
  );
}
