import { LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import type { Category } from '@/types/models';

export function CategoryTabs({ categories, value, onChange }: { categories: Category[]; value: string | null; onChange: (id: string | null) => void }) {
  const t = useT();
  const { name } = useSettings();
  const tabs: { id: string | null; label: string; icon: React.ReactNode; key?: string }[] = [
    { id: null, label: t('pos.allCategories'), icon: <LayoutGrid className="size-6" strokeWidth={1.5} /> },
    ...categories.map((c, i) => ({
      id: c.id,
      label: name(c),
      icon: c.image_url ? <img src={c.image_url} alt="" className="size-8 rounded-btn object-cover" /> : <CategoryIcon icon={c.icon} className="size-6" />,
      key: i < 6 ? `F${i + 1}` : undefined,
    })),
  ];
  return (
    <div role="tablist" className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id ?? 'all'}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex min-h-[76px] min-w-[88px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border px-3 text-sm transition-colors',
              active ? 'border-line-strong bg-elevated font-medium text-fg shadow-glow-sm' : 'border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg',
            )}
          >
            {active && <span className="slash absolute start-2.5 top-2.5" aria-hidden />}
            <span className="relative text-fg-3">{tab.icon}</span>
            <span className="relative">{tab.label}</span>
            {tab.key && <kbd className="mono absolute end-2 top-1.5 text-[11px] text-fg-3">{tab.key}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
