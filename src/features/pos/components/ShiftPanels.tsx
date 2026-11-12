import { useState } from 'react';
import { motion } from 'motion/react';
import { Printer, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { printZReport } from '@/lib/print';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Keypad, applyKey } from '@/components/ui/Keypad';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import type { CashShift, ShiftReport } from '@/types/models';
import { closeShift, openShift } from '../api';

/** Blocking panel shown to cashiers until a cash shift is opened. */
export function OpenShiftPanel({ onOpened }: { onOpened: (s: CashShift) => void }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const toast = useToast();
  const [entry, setEntry] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    try {
      onOpened(await openShift(Number(entry) || 0));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid h-full place-items-center p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm rounded-panel border border-line bg-surface p-6 shadow-panel">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-card bg-brand/15 text-[#ff5a67]">
            <Wallet className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-bold">{t('shift.openTitle')}</h2>
            <p className="text-sm text-fg-3">{t('shift.openHint')}</p>
          </div>
        </div>
        <div className="mb-3 rounded-card border border-line bg-card p-4">
          <p className="text-xs text-fg-3">{t('shift.openingFloat')}</p>
          <p className="num text-3xl font-bold">{f.money(Number(entry) || 0)}</p>
        </div>
        <Keypad onKey={(k) => setEntry((v) => applyKey(v, k))} />
        <Button variant="primary" size="lg" block className="mt-4" loading={pending} onClick={() => void submit()}>
          {t('shift.open')}
        </Button>
      </motion.div>
    </div>
  );
}

export function ZReportView({ report }: { report: ShiftReport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const s = report.shift;
  const variance = s.counted_cash !== null ? Number(s.counted_cash) - Number(report.expected_cash) : null;
  const rows: [string, string][] = [
    [t('shift.ordersCount'), f.number(report.orders_count)],
    [t('shift.grossTotal'), f.money(report.gross_total)],
    [t('shift.discounts'), f.money(report.discount_total)],
    [t('shift.voided'), `${f.number(report.voided_count)} · ${f.money(report.voided_total)}`],
    [t('shift.openingFloat'), f.money(Number(s.opening_float))],
    [t('shift.cashSales'), f.money(report.cash_sales)],
    [t('shift.cardSales'), f.money(report.card_sales)],
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-line rounded-card border border-line bg-card">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
            <dt className="text-fg-2">{k}</dt>
            <dd className="num font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-card border border-line bg-card p-3">
          <p className="text-xs text-fg-3">{t('shift.expectedCash')}</p>
          <p className="num text-lg font-bold">{f.money(report.expected_cash)}</p>
        </div>
        <div className="rounded-card border border-line bg-card p-3">
          <p className="text-xs text-fg-3">{t('shift.countedCash')}</p>
          <p className="num text-lg font-bold">{s.counted_cash !== null ? f.money(Number(s.counted_cash)) : t('common.none')}</p>
        </div>
        <div className={cn('rounded-card border p-3', variance === null || Math.abs(variance) < 0.01 ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10')}>
          <p className="text-xs text-fg-3">{t('shift.variance')}</p>
          <p className={cn('num text-lg font-bold', variance !== null && Math.abs(variance) >= 0.01 ? 'text-danger' : 'text-success')}>
            {variance === null ? t('common.none') : f.money(variance)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CloseShiftModal({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed: () => void }) {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const toast = useToast();
  const [entry, setEntry] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<ShiftReport | null>(null);

  const submit = async () => {
    setPending(true);
    try {
      const r = await closeShift(Number(entry) || 0, notes);
      setReport(r);
      toast.success(t('shift.closed'));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  const finish = () => {
    const closed = report !== null;
    setReport(null);
    setEntry('');
    setNotes('');
    if (closed) onClosed();
    else onClose();
  };

  return (
    <Modal
      open={open}
      onClose={finish}
      dismissable={!pending}
      title={report ? t('shift.zReport') : t('shift.closeTitle')}
      size="md"
      footer={
        report ? (
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => void printZReport(report, { t, f, settings }, lang)}>
              {t('shift.printZ')}
            </Button>
            <Button variant="primary" onClick={finish}>
              {t('common.close')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={finish}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={pending} onClick={() => void submit()}>
              {t('shift.close')}
            </Button>
          </>
        )
      }
    >
      {report ? (
        <ZReportView report={report} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-card p-4">
            <p className="text-xs text-fg-3">{t('shift.countedCash')}</p>
            <p className="num text-3xl font-bold">{f.money(Number(entry) || 0)}</p>
          </div>
          <Keypad onKey={(k) => setEntry((v) => applyKey(v, k))} />
          <Textarea label={t('shift.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
        </div>
      )}
    </Modal>
  );
}
