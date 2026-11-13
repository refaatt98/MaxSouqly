import { motion } from 'motion/react';
import { SearchX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { FoodImage } from '@/components/ui/FoodImage';
import { EmptyState } from '@/components/ui/EmptyState';
import type { MenuItem } from '@/types/models';

export function ProductGrid({ items, selectedId, onAdd }: { items: MenuItem[]; selectedId: string | null; onAdd: (item: MenuItem) => void }) {
  const t = useT();
  const { name, f } = useSettings();
  if (items.length === 0) return <EmptyState icon={<SearchX className="size-7" />} title={t('common.noResults')} />;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-3">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <motion.button
            key={item.id}
            type="button"
            layout="position"
            whileTap={item.is_available ? { scale: 0.95 } : undefined}
            disabled={!item.is_available}
            onClick={() => onAdd(item)}
            className={cn(
              'group relative flex flex-col overflow-hidden rounded-card border bg-card p-1.5 text-start sm:p-2 transition-[background-color,border-color] duration-150',
              selected ? 'border-line-strong bg-elevated' : 'border-line hover:border-line-strong hover:bg-elevated',
              !item.is_available && 'cursor-not-allowed opacity-45 grayscale',
            )}
            aria-label={`${name(item)} — ${f.money(Number(item.price))}`}
          >
            <FoodImage src={item.image_url} alt="" className="aspect-[4/3] w-full rounded-[6px] p-1.5" />
            <span className="mt-1.5 line-clamp-2 min-h-8 text-xs leading-4 text-fg sm:mt-2 sm:min-h-10 sm:text-sm sm:leading-5">{name(item)}</span>
            <span className="num mt-1 text-[0.8125rem] font-medium text-fg-2 sm:text-[0.9375rem]">{f.money(Number(item.price))}</span>
            {selected && <span className="slash absolute start-3 top-3" aria-hidden />}
            {!item.is_available && (
              <span className="absolute start-2 top-2 rounded-[4px] bg-bg/90 px-1.5 py-0.5 text-[0.6875rem] text-fg-2">{t('pos.unavailable')}</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
