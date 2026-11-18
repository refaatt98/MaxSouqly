import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { useCosts } from '@/hooks/useCosts';
import { MENU_ITEM_COLS } from '@/lib/columns';
import { errorMessage } from '@/lib/errors';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Input';
import { FoodImage } from '@/components/ui/FoodImage';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import type { Ingredient, MenuItem, UnitType } from '@/types/models';
import { compatibleUnits, defaultRecipeUnit, unitFactor } from '../api';
import { OptionsEditor } from '@/features/menu/components/OptionsEditor';

interface Line {
  key: string;
  id?: string;
  ingredient_id: string;
  quantity: string;
  unit: UnitType;
}

export function RecipesTab({ ingredients }: { ingredients: Ingredient[] }) {
  const t = useT();
  const costs = useCosts();
  const { f, name } = useSettings();
  const toast = useToast();
  const menu = useQuery(async () => {
    const { data, error } = await supabase.from('menu_items').select(MENU_ITEM_COLS).order('name_ar');
    if (error) throw error;
    return data;
  }, []);
  useLiveRefetch(['menu_items'], menu.refetch);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [original, setOriginal] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  useEffect(() => {
    if (!selected) return;
    setLines(null);
    void supabase
      .from('recipe_items')
      .select('*')
      .eq('menu_item_id', selected.id)
      .then(({ data, error }) => {
        if (error) toast.error(errorMessage(t, error));
        const ls = (data ?? []).map((r) => ({ key: r.id, id: r.id, ingredient_id: r.ingredient_id, quantity: String(r.quantity), unit: r.unit }));
        setLines(ls);
        setOriginal(ls.map((l) => l.id as string));
      });
  }, [selected, t, toast]);

  const lineCost = (l: Line) => {
    const ing = byId.get(l.ingredient_id);
    if (!ing) return 0;
    const factor = unitFactor(l.unit, ing.unit);
    return factor === null ? 0 : (Number(l.quantity) || 0) * factor * (costs.ingredient(ing.id) ?? 0);
  };
  const cost = (lines ?? []).reduce((s, l) => s + lineCost(l), 0);
  const price = Number(selected?.price ?? 0);
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0;

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!selected || !lines) return;
    const valid = lines.filter((l) => l.ingredient_id && Number(l.quantity) > 0);
    const ids = new Set(valid.map((l) => l.ingredient_id));
    if (valid.length !== lines.length || ids.size !== valid.length) {
      toast.error(t('validation.positive'));
      return;
    }
    setPending(true);
    try {
      const keep = new Set(valid.filter((l) => l.id).map((l) => l.id as string));
      const removed = original.filter((id) => !keep.has(id));
      if (removed.length) {
        const { error } = await supabase.from('recipe_items').delete().in('id', removed);
        if (error) throw error;
      }
      for (const l of valid) {
        const row = { menu_item_id: selected.id, ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit: l.unit };
        const { error } = l.id ? await supabase.from('recipe_items').update(row).eq('id', l.id) : await supabase.from('recipe_items').insert(row);
        if (error) throw error;
      }
      toast.success(t('common.saved'));
      const { data } = await supabase.from('menu_items').select(MENU_ITEM_COLS).eq('id', selected.id).single();
      if (data) setSelected(data);
      void menu.refetch();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  const items = (menu.data ?? []).filter((m) => !search.trim() || m.name_ar.includes(search.trim()) || m.name_he.includes(search.trim()));

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="flex max-h-[70dvh] flex-col p-2">
        <TextInput icon={<Search className="size-4" />} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="p-1" aria-label={t('common.search')} />
        <ul className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {menu.loading && !menu.data ? <SkeletonRows rows={6} /> : items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelected(m)}
                className={cn('flex w-full items-center gap-3 rounded-btn p-2 text-start', selected?.id === m.id ? 'bg-elevated shadow-glow-sm' : 'hover:bg-fg/[0.04]')}
              >
                <FoodImage src={m.image_url} alt="" className="size-10" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{name(m)}</span>
                  <span className="num block text-xs text-fg-3">{f.money(Number(m.price))}{costs.allowed && <> · {t('common.cost')} {f.money(costs.menuItem(m.id) ?? 0)}</>}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        {!selected ? (
          <EmptyState icon={<BookOpen className="size-7" />} title={t('recipes.selectItem')} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <FoodImage src={selected.image_url} alt="" className="size-16" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold">{name(selected)}</h2>
                <p className="num text-sm text-fg-3">{t('common.price')}: {f.money(price)}</p>
              </div>
              {costs.allowed && <div className="text-end">
                <p className="text-xs text-fg-3">{t('recipes.costTotal')}</p>
                <p className="num text-2xl font-medium text-fg">{f.money(cost)}</p>
                <p className={cn('num text-xs font-semibold', margin >= 60 ? 'text-success' : margin >= 40 ? 'text-warning' : 'text-danger')}>
                  {t('recipes.marginHint', { margin: f.number(margin, 0) })}
                </p>
              </div>}
            </div>
            {!lines ? (
              <SkeletonRows rows={4} />
            ) : (
              <div className="space-y-2">
                {lines.length === 0 && <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-fg-3">{t('recipes.empty')}</p>}
                {lines.map((l) => {
                  const ing = byId.get(l.ingredient_id);
                  return (
                    <div key={l.key} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-card border border-line bg-surface p-3 md:grid-cols-[2fr_1fr_1fr_auto_auto]">
                      <Select
                        className="col-span-2 md:col-span-1"
                        label={t('recipes.ingredient')}
                        value={l.ingredient_id}
                        placeholder="—"
                        onChange={(e) => {
                          const next = byId.get(e.target.value);
                          update(l.key, { ingredient_id: e.target.value, unit: next ? defaultRecipeUnit(next.unit) : l.unit });
                        }}
                        options={ingredients.map((i) => ({ value: i.id, label: name(i) }))}
                      />
                      <TextInput label={t('common.quantity')} type="number" inputMode="decimal" min={0} step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                      <Select
                        label={t('inventory.unit')}
                        value={l.unit}
                        onChange={(e) => update(l.key, { unit: e.target.value as UnitType })}
                        options={(ing ? compatibleUnits(ing.unit) : [l.unit]).map((u) => ({ value: u, label: t(`unit.${u}`) }))}
                      />
                      {costs.allowed && (
                        <div className="pb-2.5">
                          <p className="text-xs text-fg-3">{t('recipes.unitCost')}</p>
                          <p className="num font-semibold">{f.money(lineCost(l))}</p>
                        </div>
                      )}
                      <IconButton label={t('common.delete')} className="hover:text-danger" onClick={() => setLines((ls) => (ls ?? []).filter((x) => x.key !== l.key))}>
                        <X className="size-4" />
                      </IconButton>
                    </div>
                  );
                })}
                <div className="flex justify-between pt-2">
                  <Button icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...(ls ?? []), { key: crypto.randomUUID(), ingredient_id: '', quantity: '', unit: 'g' }])}>
                    {t('recipes.addIngredient')}
                  </Button>
                  <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
                </div>
                <div className="pt-4">
                  <h3 className="mb-1 text-sm text-fg">{t('recipes.optionsTitle')}</h3>
                  <p className="mb-3 text-xs text-fg-3">{t('recipes.optionsHint')}</p>
                  <OptionsEditor menuItemId={selected.id} />
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
