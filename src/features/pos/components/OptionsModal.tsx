import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FoodImage } from '@/components/ui/FoodImage';
import type { MenuItem, MenuItemOption } from '@/types/models';
import type { CartOption } from '../cart';

/** Extras (cheese, sauce…) picked before an item goes into the cart. */
export function OptionsModal({ item, options, qty, onClose, onAdd }: {
  item: MenuItem | null;
  options: MenuItemOption[];
  qty: number;
  onClose: () => void;
  onAdd: (picked: CartOption[]) => void;
}) {
  const t = useT();
  const { name, f } = useSettings();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set()), [item]);

  const chosen = options.filter((o) => picked.has(o.id));
  const unit = Number(item?.price ?? 0) + chosen.reduce((s, o) => s + Number(o.price), 0);
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      size="sm"
      title={item ? name(item) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => onAdd(chosen.map((o) => ({ id: o.id, name_ar: o.name_ar, name_he: o.name_he, price: Number(o.price) })))}
          >
            {t('pos.addToCart')} · <span className="num">{f.money(unit * qty)}</span>
          </Button>
        </>
      }
    >
      {item && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <FoodImage src={item.image_url} alt="" className="size-16 shrink-0 rounded-btn" />
            <div>
              <p className="text-sm text-fg-2">{t('pos.chooseExtras')}</p>
              <p className="num text-lg text-fg">{f.money(Number(item.price))}{qty > 1 && <span className="text-sm text-fg-3"> × {f.number(qty)}</span>}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => {
              const on = picked.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    'flex min-h-14 items-center gap-2 rounded-card border px-3 py-2 text-start transition-colors',
                    on ? 'border-brand/60 bg-brand/10 text-fg' : 'border-line bg-card text-fg-2 hover:border-line-strong',
                  )}
                >
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded border', on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
                    {on && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{name(o)}</span>
                    <span className="num block text-xs text-fg-3">{Number(o.price) > 0 ? `+${f.money(Number(o.price))}` : t('pos.free')}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
