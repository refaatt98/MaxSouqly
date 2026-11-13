import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Ban, Minus, Plus, Repeat, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useQuery } from '@/hooks/useQuery';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FoodImage } from '@/components/ui/FoodImage';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import { fetchCatalog } from '@/features/pos/api';
import type { MenuItem } from '@/types/models';
import { cancelOrder, replaceOrderItem, voidOrderItem, type EditResult } from '../api';

export interface EditableItem {
  id: string;
  menu_item_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  image_url: string | null;
  notes: string;
  voided: boolean;
}

export interface EditableOrder {
  id: string;
  order_number: number;
  items: EditableItem[];
}

const REASONS = ['edit.reasons.cancelled', 'edit.reasons.changed', 'edit.reasons.outOfStock', 'edit.reasons.mistake'] as const;

/**
 * Change an order after it was sent: cancel a line (or part of it), replace a line, or cancel everything.
 * Stock and money are adjusted on the server; the dialog tells the cashier what to return or collect.
 */
export function EditOrderModal({ order, onClose, onChanged }: { order: EditableOrder | null; onClose: () => void; onChanged: (o: EditResult | null) => void }) {
  const t = useT();
  const { f, name } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const [cancelQty, setCancelQty] = useState<Record<string, number>>({});
  const [replacing, setReplacing] = useState<EditableItem | null>(null);
  const [replaceQty, setReplaceQty] = useState(1);
  const [pick, setPick] = useState<MenuItem | null>(null);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const catalog = useQuery(fetchCatalog, [], { enabled: replacing !== null });

  useEffect(() => {
    if (!order) return;
    setReason('');
    setCustom('');
    setCancelQty({});
    setReplacing(null);
    setLastDelta(null);
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalReason = (reason === 'custom' ? custom : reason ? t(reason as (typeof REASONS)[number]) : '').trim();
  const live = useMemo(() => (order?.items ?? []).filter((i) => !i.voided), [order]);
  const voided = useMemo(() => (order?.items ?? []).filter((i) => i.voided), [order]);
  const products = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (catalog.data?.items ?? []).filter((m) => m.is_available && (!needle || m.name_ar.toLowerCase().includes(needle) || m.name_he.toLowerCase().includes(needle)));
  }, [catalog.data, search]);

  const needReason = () => {
    if (finalReason.length >= 2) return false;
    toast.error(t('edit.pickReason'));
    return true;
  };

  const after = (res: EditResult | null) => {
    const delta = Number(res?.money_delta ?? 0);
    setLastDelta(delta);
    if (delta < -0.009) toast.info(t('edit.refund', { amount: f.money(Math.abs(delta)) }));
    else if (delta > 0.009) toast.info(t('edit.collect', { amount: f.money(delta) }));
    else toast.success(t('edit.done'));
    onChanged(res);
  };

  const doCancelItem = async (item: EditableItem) => {
    if (needReason()) return;
    setPending(item.id);
    try {
      const qty = cancelQty[item.id] ?? item.quantity;
      after(await voidOrderItem(item.id, qty, finalReason));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(null);
    }
  };

  const doReplace = async () => {
    if (!replacing || !pick || needReason()) return;
    setPending('replace');
    try {
      after(await replaceOrderItem(replacing.id, pick.id, replaceQty, replacing.notes, finalReason));
      setReplacing(null);
      setPick(null);
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(null);
    }
  };

  const doCancelOrder = async () => {
    if (!order || needReason()) return;
    if (!(await confirm({ title: t('edit.cancelOrder'), body: t('edit.cancelOrderConfirm', { number: order.order_number }), danger: true }))) return;
    setPending('order');
    try {
      await cancelOrder(order.id, finalReason);
      toast.success(t('orders.voided'));
      onChanged(null);
      onClose();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      size="lg"
      title={order ? t('edit.title', { number: f.digits(order.order_number) }) : ''}
      footer={
        replacing ? (
          <>
            <Button variant="ghost" icon={<ArrowRight className="size-4 rtl:-scale-x-100" />} onClick={() => { setReplacing(null); setPick(null); }}>
              {t('edit.back')}
            </Button>
            <Button variant="primary" disabled={!pick} loading={pending === 'replace'} onClick={() => void doReplace()}>
              {t('edit.confirmReplace')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" className="me-auto" icon={<Ban className="size-4" />} loading={pending === 'order'} onClick={() => void doCancelOrder()}>
              {t('edit.cancelOrder')}
            </Button>
            <Button onClick={onClose}>{t('common.close')}</Button>
          </>
        )
      }
    >
      {/* reason */}
      <div className="mb-4">
        <p className="mb-2 text-sm text-fg-2">{t('edit.reason')}</p>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn('h-10 rounded-btn border px-3 text-sm transition-colors', reason === r ? 'border-fg bg-fg text-bg' : 'border-line bg-card text-fg-2 hover:border-line-strong')}
            >
              {t(r)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setReason('custom')}
            className={cn('h-10 rounded-btn border px-3 text-sm transition-colors', reason === 'custom' ? 'border-fg bg-fg text-bg' : 'border-line bg-card text-fg-2 hover:border-line-strong')}
          >
            {t('edit.reasonCustom')}
          </button>
        </div>
        {reason === 'custom' && (
          <input
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={200}
            aria-label={t('edit.reasonCustom')}
            className="mt-2 h-11 w-full rounded-btn border border-line-strong bg-card px-3 text-sm focus:border-fg-3 focus:outline-none"
          />
        )}
      </div>

      {lastDelta !== null && Math.abs(lastDelta) >= 0.01 && (
        <div className={cn('mb-4 rounded-card border px-4 py-3 text-[0.9375rem] font-medium', lastDelta < 0 ? 'border-danger/30 bg-danger/5 text-danger' : 'border-success/30 bg-success/5 text-success')}>
          {lastDelta < 0 ? t('edit.refund', { amount: f.money(Math.abs(lastDelta)) }) : t('edit.collect', { amount: f.money(lastDelta) })}
        </div>
      )}

      {!replacing ? (
        <ul className="space-y-2">
          {live.map((item) => {
            const qty = cancelQty[item.id] ?? item.quantity;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card p-3">
                <FoodImage src={item.image_url} alt="" className="size-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fg">
                    <span className="num text-fg-3">{f.number(item.quantity)}× </span>
                    {item.name}
                  </p>
                  <p className="num text-xs text-fg-3">{f.money(item.unit_price * item.quantity)}</p>
                  {item.notes && <p className="text-xs text-warning">{item.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {item.quantity > 1 && (
                    <div className="flex items-center rounded-btn border border-line" dir="ltr">
                      <button type="button" aria-label="-" className="grid size-9 place-items-center text-fg-2" onClick={() => setCancelQty((c) => ({ ...c, [item.id]: Math.max(1, qty - 1) }))}>
                        <Minus className="size-4" />
                      </button>
                      <span className="num w-6 text-center text-sm">{f.number(qty)}</span>
                      <button type="button" aria-label="+" className="grid size-9 place-items-center text-fg-2" onClick={() => setCancelQty((c) => ({ ...c, [item.id]: Math.min(item.quantity, qty + 1) }))}>
                        <Plus className="size-4" />
                      </button>
                    </div>
                  )}
                  <Button size="sm" variant="danger" icon={<X className="size-4" />} loading={pending === item.id} onClick={() => void doCancelItem(item)}>
                    {item.quantity > 1 ? t('edit.cancelHowMany', { count: f.number(qty), total: f.number(item.quantity) }) : t('edit.cancelItem')}
                  </Button>
                  <Button size="sm" icon={<Repeat className="size-4" />} onClick={() => { setReplacing(item); setReplaceQty(item.quantity); setPick(null); setSearch(''); }}>
                    {t('edit.replace')}
                  </Button>
                </div>
              </li>
            );
          })}
          {voided.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-card border border-dashed border-line px-3 py-2 text-sm text-fg-3">
              <span className="num">{f.number(item.quantity)}×</span>
              <span className="flex-1 truncate line-through">{item.name}</span>
              <span>{t('edit.cancelledLine')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <p className="mb-3 text-sm text-fg-2">{t('edit.replaceWith', { name: replacing.name })}</p>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              className="h-11 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm focus:border-fg-3 focus:outline-none"
            />
          </div>
          {catalog.loading && !catalog.data ? (
            <SkeletonGrid count={6} />
          ) : (
            <div className="grid max-h-[46dvh] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 overflow-y-auto">
              {products.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPick(m)}
                  className={cn('relative rounded-card border bg-card p-2 text-start transition-colors', pick?.id === m.id ? 'border-fg bg-elevated' : 'border-line hover:border-line-strong')}
                >
                  {pick?.id === m.id && <span className="slash absolute start-2 top-2" aria-hidden />}
                  <FoodImage src={m.image_url} alt="" className="aspect-[4/3] w-full" />
                  <span className="mt-1 block truncate text-sm text-fg">{name(m)}</span>
                  <span className="num text-xs text-fg-2">{f.money(Number(m.price))}</span>
                </button>
              ))}
            </div>
          )}
          {pick && (
            <div className="mt-3 flex items-center justify-between rounded-card border border-line bg-card px-3 py-2">
              <span className="text-sm text-fg">{name(pick)}</span>
              <div className="flex items-center rounded-btn border border-line" dir="ltr">
                <button type="button" aria-label="-" className="grid size-9 place-items-center" onClick={() => setReplaceQty((q) => Math.max(1, q - 1))}>
                  <Minus className="size-4" />
                </button>
                <span className="num w-6 text-center text-sm">{f.number(replaceQty)}</span>
                <button type="button" aria-label="+" className="grid size-9 place-items-center" onClick={() => setReplaceQty((q) => Math.min(99, q + 1))}>
                  <Plus className="size-4" />
                </button>
              </div>
              <span className="num text-sm text-fg-2">{f.money(Number(pick.price) * replaceQty)}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
