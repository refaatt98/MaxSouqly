import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Shuffle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { round2 } from '@/lib/format';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Tabs';
import { Keypad, applyKey } from '@/components/ui/Keypad';
import type { OrderPayload } from '@/lib/offlineQueue';

type Method = 'cash' | 'card' | 'mixed';

export interface PaymentResult {
  payments: OrderPayload['payments'];
  change: number;
}

/** Suggested banknotes above the amount due (₪ 20 / 50 / 100 / 200). */
function quickAmounts(due: number): number[] {
  const out = new Set<number>();
  for (const note of [20, 50, 100, 200]) {
    const v = Math.ceil(due / note) * note;
    if (v > due) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function PaymentModal({ open, due, onClose, onConfirm, pending }: {
  open: boolean;
  due: number;
  onClose: () => void;
  onConfirm: (r: PaymentResult) => void;
  pending: boolean;
}) {
  const t = useT();
  const { f } = useSettings();
  const [method, setMethod] = useState<Method>('cash');
  const [entry, setEntry] = useState('');

  useEffect(() => {
    if (open) {
      setMethod('cash');
      setEntry('');
    }
  }, [open]);

  const amount = Number(entry) || 0;
  const calc = useMemo(() => {
    if (method === 'cash') {
      const tendered = entry === '' ? due : amount;
      return { valid: tendered >= due - 0.001, change: round2(Math.max(tendered - due, 0)), cash: due, card: 0, tendered };
    }
    if (method === 'card') return { valid: true, change: 0, cash: 0, card: due, tendered: 0 };
    const cash = Math.min(amount, due);
    return { valid: amount > 0 && amount < due, change: 0, cash: round2(cash), card: round2(due - cash), tendered: cash };
  }, [method, entry, amount, due]);

  const confirm = () => {
    if (!calc.valid || pending) return;
    const payments: OrderPayload['payments'] = [];
    if (due > 0) {
      if (method === 'cash') payments.push({ method: 'cash', amount: due, tendered: calc.tendered });
      else if (method === 'card') payments.push({ method: 'card', amount: due });
      else payments.push({ method: 'cash', amount: calc.cash, tendered: calc.cash }, { method: 'card', amount: calc.card });
    }
    onConfirm({ payments, change: calc.change });
  };

  // Enter confirms, digits type into the keypad
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      } else if (/^[0-9.]$/.test(e.key)) setEntry((v) => applyKey(v, e.key));
      else if (e.key === 'Backspace') setEntry((v) => applyKey(v, 'back'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!pending}
      title={t('payment.title')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="success" size="xl" onClick={confirm} disabled={!calc.valid} loading={pending} className="min-w-56" data-autofocus>
            {pending ? t('payment.processing') : t('payment.confirm')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-card p-5 text-center">
            <p className="text-sm text-fg-2">{t('payment.due')}</p>
            <p className="num mt-2 text-[44px] leading-none font-medium text-fg">{f.money(due)}</p>
          </div>
          <Segmented
            size="lg"
            className="w-full"
            layoutId="pay-method"
            value={method}
            onChange={(m) => {
              setMethod(m);
              setEntry('');
            }}
            items={[
              { key: 'cash', label: t('payment.cash'), icon: <Banknote className="size-5" /> },
              { key: 'card', label: t('payment.card'), icon: <CreditCard className="size-5" /> },
              { key: 'mixed', label: t('payment.mixed'), icon: <Shuffle className="size-5" /> },
            ]}
          />
          {method === 'cash' && (
            <div className="space-y-3">
              <div className="rounded-card border border-line bg-card p-4">
                <p className="text-xs text-fg-3">{t('payment.cashGiven')}</p>
                <p className="num text-[28px] leading-none font-medium">{f.money(entry === '' ? due : amount)}</p>
              </div>
              <div className="rounded-card border border-line bg-card p-4">
                <p className="text-xs text-fg-2">{calc.valid ? t('payment.changeDue') : t('payment.insufficient')}</p>
                <p className={cn('num text-[28px] leading-none font-medium', calc.valid ? 'text-fg' : 'text-danger')}>{f.money(calc.valid ? calc.change : due - amount)}</p>
              </div>
            </div>
          )}
          {method === 'card' && (
            <div className="grid place-items-center rounded-card border border-line bg-card p-8 text-center">
              <CreditCard className="size-10 text-fg-3" strokeWidth={1.5} />
              <p className="num mt-3 text-2xl font-semibold">{f.money(due)}</p>
            </div>
          )}
          {method === 'mixed' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-card border border-line bg-card p-4">
                <p className="text-xs text-fg-3">{t('payment.cashPart')}</p>
                <p className="num text-2xl font-semibold">{f.money(calc.cash)}</p>
              </div>
              <div className="rounded-card border border-line bg-card p-4">
                <p className="text-xs text-fg-3">{t('payment.cardPart')}</p>
                <p className="num text-2xl font-semibold text-fg-2">{f.money(calc.card)}</p>
              </div>
            </div>
          )}
        </div>
        <div className={cn('space-y-3', method === 'card' && 'pointer-events-none opacity-30')} aria-hidden={method === 'card'}>
          {method === 'cash' && (
            <div className="grid grid-cols-4 gap-2">
              <button type="button" onClick={() => setEntry(String(due))} className="h-12 rounded-btn border border-line-strong bg-elevated px-1 text-xs whitespace-nowrap text-fg">
                {t('payment.exact')}
              </button>
              {quickAmounts(due).map((v) => (
                <button key={v} type="button" onClick={() => setEntry(String(v))} className="num h-12 rounded-btn border border-line bg-elevated text-sm transition-colors hover:border-line-strong">
                  {f.money(v)}
                </button>
              ))}
            </div>
          )}
          <Keypad onKey={(k) => setEntry((v) => applyKey(v, k))} />
        </div>
      </div>
    </Modal>
  );
}
