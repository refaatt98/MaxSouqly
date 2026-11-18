import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FoodImage } from '@/components/ui/FoodImage';
import type { MenuItem, MenuItemOption } from '@/types/models';
import type { CartOption } from '../cart';

/**
 * Picked before an item goes into the cart:
 * the meat type (choose one; its price is the full price of the dish) and extras, each as many times as needed.
 */
export function OptionsModal({ item, options, soldOut, qty, onClose, onAdd }: {
  item: MenuItem | null;
  options: MenuItemOption[];
  /** ids whose ingredients ran out */
  soldOut: Set<string>;
  qty: number;
  onClose: () => void;
  onAdd: (picked: CartOption[], notes: string) => void;
}) {
  const t = useT();
  const { name, f } = useSettings();
  const variants = options.filter((o) => o.kind === 'variant');
  const extras = options.filter((o) => o.kind !== 'variant');
  const [variant, setVariant] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tried, setTried] = useState(false);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    setVariant(null);
    setCounts({});
    setTried(false);
    setNotes('');
  }, [item]);

  const isOut = (o: MenuItemOption) => !o.is_active || soldOut.has(o.id);
  const chosenVariant = variants.find((v) => v.id === variant && !isOut(v));
  const base = chosenVariant ? Number(chosenVariant.price) : Number(item?.price ?? 0);
  const unit = base + extras.reduce((s, o) => s + Number(o.price) * (counts[o.id] ?? 0), 0);
  const needVariant = variants.length > 0 && !chosenVariant;
  const allOut = variants.length > 0 && variants.every(isOut);
  const step = (o: MenuItemOption, d: number) =>
    setCounts((c) => ({ ...c, [o.id]: Math.max(0, Math.min(o.max_qty, (c[o.id] ?? 0) + d)) }));

  const add = () => {
    if (needVariant) return setTried(true);
    const picked: CartOption[] = [];
    if (chosenVariant) picked.push({ id: chosenVariant.id, name_ar: chosenVariant.name_ar, name_he: chosenVariant.name_he, price: Number(chosenVariant.price), kind: 'variant', qty: 1 });
    for (const o of extras) {
      const n = isOut(o) ? 0 : counts[o.id] ?? 0;
      if (n > 0) picked.push({ id: o.id, name_ar: o.name_ar, name_he: o.name_he, price: Number(o.price), kind: 'extra', qty: n });
    }
    onAdd(picked, notes);
  };

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      size="sm"
      title={item ? name(item) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={add} disabled={allOut}>
            {t('pos.addToCart')}
            {!needVariant && <> · <span className="num">{f.money(unit * qty)}</span></>}
          </Button>
        </>
      }
    >
      {item && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <FoodImage src={item.image_url} alt="" className="size-16 shrink-0 rounded-btn" />
            <p className="num text-lg text-fg">
              {allOut ? t('pos.allVariantsOut') : needVariant ? t('pos.chooseVariantFirst') : f.money(unit)}
              {qty > 1 && <span className="text-sm text-fg-3"> × {f.number(qty)}</span>}
            </p>
          </div>

          {variants.length > 0 && (
            <section>
              <h3 className={cn('mb-2 text-sm', tried && needVariant ? 'text-danger' : 'text-fg-2')}>{t('pos.chooseVariant')}</h3>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('pos.chooseVariant')}>
                {variants.map((v) => {
                  const on = v.id === variant;
                  const out = isOut(v);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={out}
                      onClick={() => setVariant(v.id)}
                      className={cn(
                        'flex min-h-14 items-center gap-2 rounded-card border px-3 py-2 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        on ? 'border-brand/60 bg-brand/10 text-fg' : tried && needVariant ? 'border-danger/50 bg-card text-fg-2' : 'border-line bg-card text-fg-2 hover:border-line-strong',
                      )}
                    >
                      <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
                        {on && <Check className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{name(v)}</span>
                        {out ? (
                          <span className="block text-xs font-medium text-danger">{t('pos.soldOut')}</span>
                        ) : (
                          <span className="num block text-xs text-fg-3">{f.money(Number(v.price))}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {extras.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm text-fg-2">{t('pos.chooseExtras')}</h3>
              <ul className="space-y-2">
                {extras.map((o) => {
                  const n = counts[o.id] ?? 0;
                  const out = isOut(o);
                  return (
                    <li key={o.id} className={cn('flex items-center gap-3 rounded-card border px-3 py-2', out ? 'border-line bg-card opacity-50' : n > 0 ? 'border-brand/60 bg-brand/10' : 'border-line bg-card')}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{name(o)}</span>
                        {out ? (
                          <span className="block text-xs font-medium text-danger">{t('pos.soldOut')}</span>
                        ) : (
                          <span className="num block text-xs text-fg-3">{Number(o.price) > 0 ? `+${f.money(Number(o.price))}` : t('pos.free')}</span>
                        )}
                      </span>
                      <div className="flex items-center rounded-btn border border-line bg-surface" dir="ltr">
                        <button type="button" onClick={() => step(o, -1)} disabled={n === 0} className="grid size-10 place-items-center text-fg-2 hover:text-fg disabled:opacity-30" aria-label={`${name(o)} -1`}>
                          <Minus className="size-4" />
                        </button>
                        <span className="num w-7 text-center text-[0.9375rem]">{f.number(n)}</span>
                        <button type="button" onClick={() => step(o, 1)} disabled={out || n >= o.max_qty} className="grid size-10 place-items-center text-fg-2 hover:text-fg disabled:opacity-30" aria-label={`${name(o)} +1`}>
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section>
            <label htmlFor="opt-notes" className="mb-2 block text-sm text-fg-2">{t('pos.kitchenNotes')}</label>
            <textarea
              id="opt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder={t('pos.kitchenNotesPlaceholder')}
              className="w-full resize-none rounded-btn border border-line-strong bg-surface px-3 py-2 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
            />
          </section>
        </div>
      )}
    </Modal>
  );
}
