import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FoodImage } from '@/components/ui/FoodImage';
import type { MenuItem, MenuItemOption } from '@/types/models';
import type { CartOption } from '../cart';

/** Small heading of a section with its "required / optional" tag. */
function SectionHead({ title, tag, tone, done }: { title: string; tag: string; tone: 'required' | 'optional'; done?: boolean }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h3 className="text-[0.9375rem] font-medium text-fg">{title}</h3>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs',
          done ? 'bg-success/15 text-success' : tone === 'required' ? 'bg-brand/15 text-brand' : 'bg-fg/[0.06] text-fg-3',
        )}
      >
        {done && <Check className="size-3" />}
        {tag}
      </span>
    </div>
  );
}

/**
 * Picked before an item goes into the cart (or when editing a cart line):
 * the meat type (choose one; its price is the full price of the dish), extras (each as many times as needed)
 * and a note for the kitchen.
 */
export function OptionsModal({ item, options, soldOut, qty, initial, onClose, onAdd }: {
  item: MenuItem | null;
  /** editing a line already in the cart: its current choices */
  initial?: { options: CartOption[]; notes: string } | null;
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
    const opts = initial?.options ?? [];
    setVariant(opts.find((o) => o.kind === 'variant')?.id ?? null);
    setCounts(Object.fromEntries(opts.filter((o) => o.kind !== 'variant').map((o) => [o.id, o.qty ?? 1])));
    setTried(false);
    setNotes(initial?.notes ?? '');
  }, [item, initial]);

  const isOut = (o: MenuItemOption) => !o.is_active || soldOut.has(o.id);
  const chosenVariant = variants.find((v) => v.id === variant && !isOut(v));
  const base = chosenVariant ? Number(chosenVariant.price) : Number(item?.price ?? 0);
  const extrasTotal = extras.reduce((s, o) => s + (isOut(o) ? 0 : Number(o.price) * (counts[o.id] ?? 0)), 0);
  const unit = base + extrasTotal;
  const needVariant = variants.length > 0 && !chosenVariant;
  const allOut = variants.length > 0 && variants.every(isOut);
  const open = variants.filter((v) => !isOut(v)).map((v) => Number(v.price));
  const fromPrice = open.length ? Math.min(...open) : null;
  const pickedExtras = extras.filter((o) => !isOut(o) && (counts[o.id] ?? 0) > 0);
  const step = (o: MenuItemOption, d: number) =>
    setCounts((c) => ({ ...c, [o.id]: Math.max(0, Math.min(o.max_qty, (c[o.id] ?? 0) + d)) }));

  const add = () => {
    if (needVariant) return setTried(true);
    const picked: CartOption[] = [];
    if (chosenVariant) picked.push({ id: chosenVariant.id, name_ar: chosenVariant.name_ar, name_he: chosenVariant.name_he, price: Number(chosenVariant.price), kind: 'variant', qty: 1 });
    for (const o of pickedExtras) picked.push({ id: o.id, name_ar: o.name_ar, name_he: o.name_he, price: Number(o.price), kind: 'extra', qty: counts[o.id] });
    onAdd(picked, notes);
  };

  const summary = [chosenVariant ? name(chosenVariant) : null, ...pickedExtras.map((o) => (counts[o.id] > 1 ? `${name(o)} ×${counts[o.id]}` : name(o)))].filter(Boolean).join(' · ');

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      size="md"
      title={item ? name(item) : ''}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-fg-3">{summary || t('pos.noExtras')}</p>
            <p className="num text-xl font-medium text-fg">
              {allOut ? '—' : needVariant ? <span className="text-sm text-fg-3">{t('pos.chooseVariantFirst')}</span> : f.money(unit * qty)}
              {qty > 1 && !needVariant && <span className="ms-1 text-xs text-fg-3">({f.money(unit)} × {f.number(qty)})</span>}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" size="lg" icon={initial ? <Check className="size-4" /> : <Plus className="size-4" />} onClick={add} disabled={allOut}>
            {initial ? t('pos.saveChanges') : t('pos.addToCart')}
          </Button>
        </div>
      }
    >
      {item && (
        <div className="space-y-6">
          <div className="flex items-center gap-4 rounded-card bg-fg/[0.03] p-3">
            <FoodImage src={item.image_url} alt="" className="size-20 shrink-0 rounded-btn" />
            <div className="min-w-0">
              <p className="truncate text-base text-fg">{name(item)}</p>
              <p className="text-xs text-fg-3">
                {fromPrice !== null ? t('pos.priceFrom', { price: f.money(fromPrice) }) : f.money(Number(item.price))}
              </p>
            </div>
          </div>

          {variants.length > 0 && (
            <section>
              <SectionHead
                title={t('pos.meatType')}
                tag={chosenVariant ? t('pos.chosen') : t('pos.required')}
                tone="required"
                done={Boolean(chosenVariant)}
              />
              {allOut && <p className="mb-2 text-sm text-danger">{t('pos.allVariantsOut')}</p>}
              <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t('pos.chooseVariant')}>
                {variants.map((v) => {
                  const on = v.id === variant && !isOut(v);
                  const out = isOut(v);
                  return (
                    <motion.button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={name(v)}
                      disabled={out}
                      whileTap={out ? undefined : { scale: 0.97 }}
                      onClick={() => setVariant(v.id)}
                      className={cn(
                        'relative flex min-h-[4.75rem] flex-col justify-between rounded-card border-2 p-3 text-start transition-colors',
                        on && 'border-brand bg-brand/10',
                        !on && !out && (tried && needVariant ? 'border-danger/60 bg-card' : 'border-line bg-card hover:border-line-strong'),
                        out && 'cursor-not-allowed border-dashed border-line bg-transparent',
                      )}
                    >
                      <span className={cn('pe-7 text-[0.9375rem] leading-tight', on ? 'font-medium text-fg' : out ? 'text-fg-3 line-through' : 'text-fg')}>{name(v)}</span>
                      {out ? (
                        <span className="mt-1.5 self-start rounded-full bg-danger/15 px-2 py-0.5 text-[0.6875rem] text-danger">{t('pos.soldOutShort')}</span>
                      ) : (
                        <span className={cn('num mt-1.5 text-base', on ? 'text-brand' : 'text-fg-2')}>{f.money(Number(v.price))}</span>
                      )}
                      <span
                        className={cn(
                          'absolute end-2.5 top-2.5 grid size-5 place-items-center rounded-full border-2 transition-colors',
                          on ? 'border-brand bg-brand text-white' : 'border-line-strong',
                          out && 'opacity-40',
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </section>
          )}

          {extras.length > 0 && (
            <section>
              <SectionHead
                title={t('opts.title')}
                tag={pickedExtras.length ? `+${f.money(extrasTotal)}` : t('pos.optional')}
                tone="optional"
                done={pickedExtras.length > 0}
              />
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
                {extras.map((o) => {
                  const n = isOut(o) ? 0 : counts[o.id] ?? 0;
                  const out = isOut(o);
                  return (
                    <li key={o.id} className={cn('flex items-center gap-3 px-3 py-2.5 transition-colors', n > 0 && 'bg-brand/[0.07]', out && 'opacity-50')}>
                      <span className={cn('size-1.5 shrink-0 rounded-full', n > 0 ? 'bg-brand' : 'bg-fg/15')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm', n > 0 ? 'font-medium text-fg' : 'text-fg', out && 'line-through')}>{name(o)}</span>
                        {out ? (
                          <span className="block text-xs text-danger">{t('pos.soldOutShort')}</span>
                        ) : (
                          <span className="num block text-xs text-fg-3">
                            {Number(o.price) > 0 ? `+${f.money(Number(o.price))}` : t('pos.free')}
                            {n > 1 && Number(o.price) > 0 && <span className="text-fg-2"> · {f.money(Number(o.price) * n)}</span>}
                          </span>
                        )}
                      </span>
                      {n === 0 ? (
                        <button
                          type="button"
                          onClick={() => step(o, 1)}
                          disabled={out}
                          className="flex h-10 items-center gap-1.5 rounded-btn border border-line-strong px-3 text-sm text-fg-2 transition-colors hover:border-fg-3 hover:text-fg disabled:opacity-40"
                          aria-label={`${name(o)} +1`}
                        >
                          <Plus className="size-4" /> {t('pos.addOne')}
                        </button>
                      ) : (
                        <div className="flex items-center rounded-btn border border-brand/50 bg-surface" dir="ltr">
                          <button type="button" onClick={() => step(o, -1)} className="grid size-10 place-items-center text-fg-2 hover:text-fg" aria-label={`${name(o)} -1`}>
                            <Minus className="size-4" />
                          </button>
                          <motion.span key={n} initial={{ scale: 0.7, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className="num w-7 text-center text-[0.9375rem] font-medium text-fg">
                            {f.number(n)}
                          </motion.span>
                          <button type="button" onClick={() => step(o, 1)} disabled={n >= o.max_qty} className="grid size-10 place-items-center text-fg-2 hover:text-fg disabled:opacity-30" aria-label={`${name(o)} +1`}>
                            <Plus className="size-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section>
            <SectionHead title={t('pos.kitchenNotes')} tag={t('pos.optional')} tone="optional" done={notes.trim().length > 0} />
            <textarea
              id="opt-notes"
              aria-label={t('pos.kitchenNotes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder={t('pos.kitchenNotesPlaceholder')}
              className="w-full resize-none rounded-card border border-line bg-card px-3 py-2.5 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
            />
          </section>
        </div>
      )}
    </Modal>
  );
}
