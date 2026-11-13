import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { printReceipt, receiptFromOrder } from '@/lib/print';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import type { Order } from '@/types/models';
import { addPayment } from '../api';
import { PaymentModal, type PaymentResult } from './PaymentModal';

type Row = Pick<Order, 'id' | 'order_number' | 'type' | 'table_no' | 'customer_name' | 'customer_phone' | 'total' | 'paid_amount' | 'payment_status' | 'created_at'>;

export async function fetchUnpaid(): Promise<Row[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, type, table_no, customer_name, customer_phone, total, paid_amount, payment_status, created_at')
    .in('payment_status', ['unpaid', 'partial'])
    .not('status', 'in', '(cancelled,refunded)')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data;
}

/** Orders that were sent before being paid; collect the rest here. */
export function UnpaidOrdersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const toast = useToast();
  const list = useQuery(fetchUnpaid, [open], { enabled: open });
  useLiveRefetch(open ? ['orders', 'payments'] : [], list.refetch);
  const [collect, setCollect] = useState<Row | null>(null);
  const [pending, setPending] = useState(false);

  const due = collect ? Math.round((Number(collect.total) - Number(collect.paid_amount)) * 100) / 100 : 0;

  const confirm = async ({ payments }: PaymentResult) => {
    if (!collect) return;
    setPending(true);
    try {
      const order = await addPayment(collect.id, payments);
      void printReceipt(receiptFromOrder(order), { t, f, settings }, lang);
      toast.success(t('pos.collected', { number: f.digits(order.order_number) }));
      setCollect(null);
      void list.refetch();
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Modal open={open && collect === null} onClose={onClose} title={t('pos.unpaidTitle')}>
        {list.loading && !list.data ? (
          <SkeletonRows rows={4} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={<Wallet className="size-6" />} title={t('pos.unpaidEmpty')} />
        ) : (
          <ul className="divide-y divide-line">
            {(list.data ?? []).map((o) => {
              const rest = Number(o.total) - Number(o.paid_amount);
              return (
                <li key={o.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-fg">
                      <span className="num font-medium">#{f.digits(o.order_number)}</span>
                      <Badge tone={o.payment_status === 'partial' ? 'amber' : 'red'}>{t(`payStatus.${o.payment_status}`)}</Badge>
                    </p>
                    <p className="truncate text-xs text-fg-3">
                      {o.type === 'dine_in' && o.table_no ? t('order.table', { table: f.digits(o.table_no) }) : t(`order.type.${o.type}`)}
                      {o.customer_name && ` · ${o.customer_name}`} · <span className="num">{f.time(o.created_at)}</span>
                    </p>
                  </div>
                  <span className="num text-sm text-fg">{f.money(rest)}</span>
                  <Button size="sm" variant="primary" onClick={() => setCollect(o)}>{t('pos.collect')}</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      <PaymentModal open={collect !== null} due={due} onClose={() => setCollect(null)} onConfirm={(r) => void confirm(r)} pending={pending} />
    </>
  );
}
