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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
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
              'group relative flex flex-col overflow-hidden rounded-card border bg-card p-2.5 text-start transition-all duration-150',
              selected ? 'border-brand ring-2 ring-brand shadow-glow' : 'border-line hover:border-line-strong hover:bg-elevated',
              !item.is_available && 'cursor-not-allowed opacity-45 grayscale',
            )}
            aria-label={`${name(item)} — ${f.money(Number(item.price))}`}
          >
            <FoodImage src={item.image_url} alt="" className="aspect-[4/3] w-full rounded-btn bg-gradient-to-b from-white/[0.03] to-transparent p-1.5" />
            <span className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 font-semibold text-fg">{name(item)}</span>
            <span className="num mt-1 text-base font-bold text-gold">{f.money(Number(item.price))}</span>
            {!item.is_available && (
              <span className="absolute start-2 top-2 rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-white">{t('pos.unavailable')}</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
