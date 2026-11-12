import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleCheck, Clock, Trash, WifiOff } from 'lucide-react';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Keypad, applyKey } from '@/components/ui/Keypad';
import { EmptyState } from '@/components/ui/EmptyState';
import { cartTotals, type HeldOrder } from '../cart';

export function CancelCartModal({ open, onClose, onConfirm, pending }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const submit = () => {
    if (reason.trim().length < 2) {
      setError(t('errors.REASON_REQUIRED'));
      return;
    }
    onConfirm(reason.trim());
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pos.cancelTitle')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.back')}
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            {t('pos.cancelConfirm')}
          </Button>
        </>
      }
    >
      <Textarea
        label={t('pos.cancelReason')}
        placeholder={t('pos.cancelReasonPlaceholder')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error}
        maxLength={200}
        data-autofocus
        required
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {['الزبون غيّر رأيه', 'خطأ في الإدخال', 'طلب مكرر'].map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-line px-3 py-1.5 text-xs text-fg-2 hover:border-line-strong hover:text-fg">
            {r}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CustomQtyModal({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (qty: number) => void }) {
  const t = useT();
  const { f } = useSettings();
  const [entry, setEntry] = useState('');
  useEffect(() => {
    if (open) setEntry('');
  }, [open]);
  const qty = Math.min(999, Math.floor(Number(entry) || 0));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pos.customQty')}
      size="sm"
      footer={
        <Button variant="primary" block disabled={qty < 1} onClick={() => onConfirm(qty)}>
          {t('common.confirm')}
        </Button>
      }
    >
      <p className="num mb-3 rounded-card border border-line bg-card p-4 text-center text-4xl font-semibold">{f.number(qty)}×</p>
      <Keypad decimal={false} extra={{ label: 'C', value: 'C' }} onKey={(k) => setEntry((v) => applyKey(v, k, 0).slice(0, 3))} />
    </Modal>
  );
}

export function HeldOrdersModal({ open, onClose, held, onResume, onDiscard }: {
  open: boolean;
  onClose: () => void;
  held: HeldOrder[];
  onResume: (h: HeldOrder) => void;
  onDiscard: (h: HeldOrder) => void;
}) {
  const t = useT();
  const { f, settings, name } = useSettings();
  return (
    <Modal open={open} onClose={onClose} title={t('pos.held')} size="md">
      {held.length === 0 ? (
        <EmptyState icon={<Clock className="size-7" />} title={t('pos.heldEmpty')} />
      ) : (
        <ul className="space-y-2">
          {held.map((h) => {
            const totals = cartTotals(h.cart, Number(settings?.vat_percent ?? 0));
            return (
              <li key={h.id} className="flex items-center gap-3 rounded-card border border-line bg-card p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-fg">
                    {t(`order.type.${h.cart.type}`)}
                    {h.cart.tableNo && ` · ${t('order.table', { table: f.digits(h.cart.tableNo) })}`} · <span className="num">{f.money(totals.total)}</span>
                  </p>
                  <p className="truncate text-xs text-fg-3">
                    {f.time(h.created_at)} — {h.cart.lines.map((l) => `${l.qty}× ${name(l.item)}`).join('، ')}
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => onResume(h)}>
                  {t('pos.resume')}
                </Button>
                <button type="button" onClick={() => onDiscard(h)} className="grid size-9 place-items-center rounded-btn text-fg-3 hover:bg-danger/15 hover:text-danger" aria-label={t('common.delete')}>
                  <Trash className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

export interface SuccessInfo {
  number: string;
  change: number;
  total: number;
  offline: boolean;
}

export function SuccessOverlay({ info, onDone }: { info: SuccessInfo | null; onDone: () => void }) {
  const t = useT();
  const { f } = useSettings();
  useEffect(() => {
    if (!info) return;
    const id = window.setTimeout(onDone, info.change > 0 ? 6000 : 3500);
    return () => window.clearTimeout(id);
  }, [info, onDone]);
  return (
    <AnimatePresence>
      {info && (
        <motion.div
          className="fixed inset-0 z-[58] grid place-items-center bg-black/45 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
          role="alertdialog"
          aria-live="assertive"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-sm overflow-hidden rounded-panel border border-line-strong bg-surface p-8 text-center shadow-panel"
          >
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, delay: 0.08, ease: [0.22, 1, 0.36, 1] }} className="relative mx-auto mb-5 grid size-16 place-items-center rounded-full border border-success/30 bg-success/10 text-success">
              {info.offline ? <WifiOff className="size-7" strokeWidth={1.5} /> : <CircleCheck className="size-8" strokeWidth={1.5} />}
            </motion.div>
            <h2 className="relative text-xl font-medium">{t('pos.successTitle')}</h2>
            <p className="num relative mt-1 text-[15px] text-fg-2">{t('pos.successOrder', { number: f.digits(info.number) })}</p>
            {info.offline && <p className="relative mt-2 text-sm text-warning">{t('pos.offlineSaved')}</p>}
            {info.change > 0 && (
              <div className="relative mt-6 rounded-card border border-line bg-card p-4">
                <p className="text-sm text-fg-2">{t('pos.successChange')}</p>
                <p className="num mt-1 text-[40px] leading-none font-medium text-fg">{f.money(info.change)}</p>
              </div>
            )}
            <Button variant="primary" size="lg" block className="relative mt-6" onClick={onDone}>
              {t('pos.newOrder')}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
