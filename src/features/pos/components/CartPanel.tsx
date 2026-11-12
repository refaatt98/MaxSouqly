import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Armchair, Bike, CirclePause, Minus, Plus, Printer, ShoppingBag, StickyNote, Wallet, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Tabs';
import { TextInput } from '@/components/ui/Input';
import { FoodImage } from '@/components/ui/FoodImage';
import { CountBadge } from '@/components/ui/Badge';
import type { CartAction, CartIssue, CartLine, CartState, CartTotals } from '../cart';

function QtyStepper({ line, dispatch }: { line: CartLine; dispatch: (a: CartAction) => void }) {
  const t = useT();
  const { f } = useSettings();
  return (
    <div className="flex items-center rounded-btn border border-line bg-surface" dir="ltr">
      <button
        type="button"
        onClick={() => dispatch({ type: 'setQty', lineId: line.lineId, qty: line.qty - 1 })}
        className="grid size-10 place-items-center text-fg-2 hover:text-fg active:scale-90"
        aria-label={`${t('common.quantity')} -1`}
      >
        <Minus className="size-4" />
      </button>
      <motion.span key={line.qty} initial={{ y: -4, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.16 }} className="num w-8 text-center text-[15px] font-medium">
        {f.number(line.qty)}
      </motion.span>
      <button
        type="button"
        onClick={() => dispatch({ type: 'setQty', lineId: line.lineId, qty: line.qty + 1 })}
        className="grid size-10 place-items-center text-fg-2 hover:text-fg active:scale-90"
        aria-label={`${t('common.quantity')} +1`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function CartLineRow({ line, dispatch }: { line: CartLine; dispatch: (a: CartAction) => void }) {
  const t = useT();
  const { name, f } = useSettings();
  const [editing, setEditing] = useState(line.notes !== '');
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -60, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.6, right: 0.1 }}
      onDragEnd={(_, info) => {
        if (info.offset.x < -90) dispatch({ type: 'remove', lineId: line.lineId });
      }}
      className="mb-2 touch-pan-y rounded-card border border-line bg-card p-2.5"
    >
      <div className="flex items-center gap-3">
        <FoodImage src={line.item.image_url} alt="" className="size-14 shrink-0 rounded-btn bg-black/[0.03]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fg">{name(line.item)}</p>
          <p className="num text-xs text-fg-3">{f.money(Number(line.item.price))}</p>
          <p className="num text-sm font-medium text-fg">{f.money(Number(line.item.price) * line.qty)}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <QtyStepper line={line} dispatch={dispatch} />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={cn('flex h-8 items-center gap-1 rounded-btn px-2 text-xs', line.notes ? 'text-warning' : 'text-fg-3 hover:text-fg')}
            >
              <StickyNote className="size-3.5" /> {t('pos.addNote')}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'remove', lineId: line.lineId })}
              className="grid size-8 place-items-center rounded-btn text-fg-3 hover:bg-danger/15 hover:text-danger"
              aria-label={t('pos.remove')}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
      {editing && (
        <input
          value={line.notes}
          onChange={(e) => dispatch({ type: 'note', lineId: line.lineId, notes: e.target.value })}
          placeholder={t('pos.itemNotePlaceholder')}
          aria-label={t('pos.itemNote')}
          maxLength={200}
          autoFocus={line.notes === ''}
          className="mt-2 h-10 w-full rounded-btn border border-line-strong bg-surface px-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
        />
      )}
    </motion.li>
  );
}

export interface CartPanelProps {
  state: CartState;
  dispatch: (a: CartAction) => void;
  totals: CartTotals;
  maxDiscount: number;
  vatPercent: number;
  tableCount: number;
  issue: CartIssue | null;
  showIssue: boolean;
  heldCount: number;
  onPay: () => void;
  onCancel: () => void;
  onPrint: () => void;
  onHold: () => void;
  onOpenHeld: () => void;
}

export function CartPanel(p: CartPanelProps) {
  const t = useT();
  const { f, settings } = useSettings();
  const { state, dispatch, totals } = p;
  const empty = state.lines.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium">
          {t('pos.cart')} <CountBadge count={totals.count} />
        </h2>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<CirclePause className="size-4" />} onClick={p.onHold} disabled={empty}>
            {t('pos.hold')}
          </Button>
          <Button size="sm" variant="outline" onClick={p.onOpenHeld} className="relative">
            {t('pos.held')}
            <CountBadge count={p.heldCount} />
          </Button>
        </div>
      </div>

      <div className="space-y-3 border-b border-line px-4 py-3">
        <Segmented
          className="w-full"
          layoutId="pos-type"
          value={state.type}
          onChange={(v) => dispatch({ type: 'orderType', value: v })}
          items={[
            { key: 'dine_in', label: t('order.type.dine_in'), icon: <Armchair className="size-4" /> },
            { key: 'takeaway', label: t('order.type.takeaway'), icon: <ShoppingBag className="size-4" /> },
            { key: 'delivery', label: t('order.type.delivery'), icon: <Bike className="size-4" /> },
          ]}
        />
        {state.type === 'dine_in' && (
          <TextInput
            label={t('pos.tableNo')}
            type="number"
            inputMode="numeric"
            min={1}
            max={p.tableCount || undefined}
            value={state.tableNo}
            onChange={(e) => dispatch({ type: 'field', field: 'tableNo', value: e.target.value })}
            error={p.showIssue && p.issue === 'table' ? t('errors.INVALID_TABLE') : null}
          />
        )}
        {state.type === 'delivery' && (
          <div className="grid grid-cols-2 gap-2">
            <TextInput label={t('pos.customerName')} value={state.customerName} onChange={(e) => dispatch({ type: 'field', field: 'customerName', value: e.target.value })} />
            <TextInput label={t('pos.customerPhone')} type="tel" dir="ltr" inputMode="tel" value={state.customerPhone} onChange={(e) => dispatch({ type: 'field', field: 'customerPhone', value: e.target.value })} />
            <TextInput
              className="col-span-2"
              label={t('pos.customerAddress')}
              value={state.customerAddress}
              onChange={(e) => dispatch({ type: 'field', field: 'customerAddress', value: e.target.value })}
              error={p.showIssue && p.issue === 'delivery' ? t('errors.DELIVERY_DETAILS_REQUIRED') : null}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center text-fg-3">
            <ShoppingBag className="mb-3 size-10 opacity-40" />
            <p className="font-semibold text-fg-2">{t('pos.cartEmpty')}</p>
            <p className="text-sm">{t('pos.cartEmptyHint')}</p>
          </div>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {state.lines.map((l) => (
                <CartLineRow key={l.lineId} line={l} dispatch={dispatch} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {!empty && (
          <input
            value={state.notes}
            onChange={(e) => dispatch({ type: 'field', field: 'notes', value: e.target.value })}
            placeholder={t('pos.orderNotes')}
            aria-label={t('pos.orderNotes')}
            maxLength={500}
            className="mt-1 h-10 w-full rounded-btn border border-line bg-surface px-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
          />
        )}
      </div>

      <div className="space-y-2 border-t border-line bg-surface/60 px-4 py-3">
        <div className="flex justify-between text-sm text-fg-2">
          <span>{t('pos.subtotal')}</span>
          <span className="num font-semibold text-fg">{f.money(totals.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
          <span>{t('pos.discount')}</span>
          <div className="flex items-center gap-1.5">
            <Segmented
              size="sm"
              layoutId="pos-disc"
              value={state.discountType}
              onChange={(v) => dispatch({ type: 'discountType', value: v })}
              items={[
                { key: 'percent', label: '%' },
                { key: 'fixed', label: settings?.currency_symbol ?? '₪' },
              ]}
            />
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={state.discountValue}
              onChange={(e) => dispatch({ type: 'field', field: 'discountValue', value: e.target.value })}
              aria-label={t('pos.discount')}
              placeholder="0"
              className={cn(
                'num h-9 w-20 rounded-btn border bg-surface px-2 text-center text-sm focus:outline-none',
                p.issue === 'discount' ? 'border-danger text-danger' : 'border-line-strong focus:border-fg-3',
              )}
            />
          </div>
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between text-sm">
            <span className={p.issue === 'discount' ? 'text-danger' : 'text-fg-3'}>{t('pos.discountMax', { max: f.number(p.maxDiscount) })}</span>
            <span className="num font-semibold text-success">-{f.money(totals.discount)}</span>
          </div>
        )}
        <div className="flex items-end justify-between pt-1">
          <div>
            <p className="text-sm text-fg-2">{t('pos.grandTotal')}</p>
            <p className="text-[11px] text-fg-3">{t('pos.vatIncluded', { rate: f.number(p.vatPercent) })}</p>
          </div>
          <motion.p key={totals.total} initial={{ opacity: 0.5 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="num text-[30px] leading-none font-medium text-fg">
            {f.money(totals.total)}
          </motion.p>
        </div>
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-2 pt-1">
          <Button variant="ghost" size="lg" onClick={p.onCancel} disabled={empty}>
            {t('pos.cancel')}
          </Button>
          <Button variant="secondary" size="lg" icon={<Printer className="size-4" />} onClick={p.onPrint} disabled={empty}>
            {t('pos.print')}
          </Button>
          <Button variant="primary" size="lg" icon={<Wallet className="size-[18px]" strokeWidth={1.5} />} onClick={p.onPay} disabled={empty} className="text-base">
            {t('pos.pay')}
          </Button>
        </div>
      </div>
    </div>
  );
}
