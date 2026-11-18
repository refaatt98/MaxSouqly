import { useState } from 'react';
import { Plus, Trash } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useQuery } from '@/hooks/useQuery';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import type { Ingredient, MenuItemOption, MenuOptionRecipe, Printer, UnitType } from '@/types/models';
import { compatibleUnits, defaultRecipeUnit } from '@/features/inventory/api';
import { SelectBox, useSelection } from '@/components/ui/Table';

type Kind = 'variant' | 'extra';

/**
 * What the customer chooses for one menu item, saved as you go:
 * meat types (choose one — each with the full price of the dish) and extras (each with a price, up to N times).
 * Both can carry their own ingredients so stock and cost follow the choice.
 */
export function OptionsEditor({ menuItemId }: { menuItemId: string }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const list = useQuery(async (): Promise<MenuItemOption[]> => {
    const { data, error } = await supabase.from('menu_item_options').select('*').eq('menu_item_id', menuItemId).order('sort_order').order('created_at');
    if (error) throw error;
    return data;
  }, [menuItemId]);
  const ingredients = useQuery(async (): Promise<Pick<Ingredient, 'id' | 'name_ar' | 'name_he' | 'unit' | 'is_active'>[]> => {
    const { data, error } = await supabase.from('ingredients').select('id, name_ar, name_he, unit, is_active').order('name_ar');
    if (error) throw error;
    return data;
  }, []);
  const sel = useSelection((list.data ?? []).map((o) => o.id));
  const [open, setOpen] = useState<string | null>(null);

  const patch = async (o: MenuItemOption, row: Partial<Pick<MenuItemOption, 'is_active' | 'price' | 'name_ar' | 'max_qty'>>) => {
    list.setData((d = []) => d.map((x) => (x.id === o.id ? { ...x, ...row } : x)));
    const { error } = await supabase.from('menu_item_options').update(row).eq('id', o.id);
    if (error) {
      toast.error(errorMessage(t, error));
      void list.refetch();
    }
  };
  const removeSelected = async () => {
    const { error } = await supabase.from('menu_item_options').delete().in('id', [...sel.ids]);
    if (error) return toast.error(errorMessage(t, error));
    sel.clear();
    void list.refetch();
  };
  const remove = async (o: MenuItemOption) => {
    const { error } = await supabase.from('menu_item_options').delete().eq('id', o.id);
    if (error) return toast.error(errorMessage(t, error));
    void list.refetch();
  };

  const group = (kind: Kind) => (list.data ?? []).filter((o) => (o.kind === 'variant' ? 'variant' : 'extra') === kind);

  return (
    <section className="space-y-4 rounded-card border border-line bg-card p-3">
      {sel.count > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="danger" icon={<Trash className="size-3.5" />} onClick={() => void removeSelected()}>
            {t('bulk.delete')} ({f.number(sel.count)})
          </Button>
        </div>
      )}
      {(['variant', 'extra'] as Kind[]).map((kind) => (
        <div key={kind}>
          <h3 className="text-sm text-fg">{t(kind === 'variant' ? 'opts.variants' : 'opts.title')}</h3>
          <p className="mb-3 text-xs text-fg-3">{t(kind === 'variant' ? 'opts.variantsHint' : 'opts.hint')}</p>
          <ul className="space-y-2">
            {group(kind).map((o) => (
              <li key={o.id} className="rounded-btn border border-line p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SelectBox checked={sel.has(o.id)} onChange={(on) => sel.toggle(o.id, on)} label={`${t('bulk.selectRow')} ${o.name_ar}`} />
                  <input
                    defaultValue={o.name_ar}
                    aria-label={t('common.name')}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== o.name_ar && void patch(o, { name_ar: e.target.value.trim() })}
                    className="h-10 min-w-32 flex-1 rounded-btn border border-line-strong bg-surface px-3 text-sm focus:border-fg-3 focus:outline-none"
                  />
                  <label className="flex items-center gap-1 text-xs text-fg-3">
                    {t(kind === 'variant' ? 'opts.fullPrice' : 'common.price')}
                    <input
                      defaultValue={String(o.price)}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v !== Number(o.price)) void patch(o, { price: v });
                      }}
                      className="num h-10 w-20 rounded-btn border border-line-strong bg-surface px-2 text-center text-sm text-fg focus:border-fg-3 focus:outline-none"
                    />
                  </label>
                  {kind === 'extra' && (
                    <label className="flex items-center gap-1 text-xs text-fg-3">
                      {t('opts.maxQty')}
                      <input
                        defaultValue={String(o.max_qty)}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={20}
                        onBlur={(e) => {
                          const v = Math.round(Number(e.target.value));
                          if (v >= 1 && v <= 20 && v !== o.max_qty) void patch(o, { max_qty: v });
                        }}
                        className="num h-10 w-14 rounded-btn border border-line-strong bg-surface px-2 text-center text-sm text-fg focus:border-fg-3 focus:outline-none"
                      />
                    </label>
                  )}
                  <Button size="sm" variant={open === o.id ? 'secondary' : 'ghost'} onClick={() => setOpen((x) => (x === o.id ? null : o.id))}>
                    {t('opts.ingredients')}
                  </Button>
                  <Toggle id={`opt-${o.id}`} checked={o.is_active} onChange={(v) => void patch(o, { is_active: v })} label="" />
                  <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(o)}>
                    <Trash className="size-4" />
                  </IconButton>
                </div>
                {open === o.id && <OptionRecipe optionId={o.id} ingredients={ingredients.data ?? []} />}
              </li>
            ))}
          </ul>
          <AddOption kind={kind} count={list.data?.length ?? 0} menuItemId={menuItemId} onAdded={() => void list.refetch()} />
        </div>
      ))}
    </section>
  );
}

function AddOption({ kind, count, menuItemId, onAdded }: { kind: Kind; count: number; menuItemId: string; onAdded: () => void }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const add = async () => {
    const n = name.trim();
    const p = Number(price || 0);
    if (!n || !Number.isFinite(p) || p < 0) return;
    const { error } = await supabase.from('menu_item_options').insert({ menu_item_id: menuItemId, name_ar: n, price: p, kind, sort_order: count + 1 });
    if (error) return toast.error(errorMessage(t, error));
    setName('');
    setPrice('');
    onAdded();
  };
  return (
    <div className="mt-2 flex items-end gap-2">
      <TextInput
        className="flex-1"
        placeholder={t(kind === 'variant' ? 'opts.variantPlaceholder' : 'opts.namePlaceholder')}
        aria-label={t('common.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void add()}
      />
      <TextInput
        className="w-28"
        placeholder={kind === 'variant' ? t('opts.fullPrice') : '0'}
        aria-label={t(kind === 'variant' ? 'opts.fullPrice' : 'common.price')}
        type="number"
        inputMode="decimal"
        min={0}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        suffix={f.money(0).replace(/[0-9.,\s]/g, '')}
      />
      <Button icon={<Plus className="size-4" />} onClick={() => void add()} disabled={!name.trim() || (kind === 'variant' && price === '')}>
        {t(kind === 'variant' ? 'opts.addVariant' : 'opts.add')}
      </Button>
    </div>
  );
}

/** Ingredients one unit of a meat type / extra uses (taken from stock with every sale). */
function OptionRecipe({ optionId, ingredients }: { optionId: string; ingredients: Pick<Ingredient, 'id' | 'name_ar' | 'name_he' | 'unit' | 'is_active'>[] }) {
  const t = useT();
  const { name, f } = useSettings();
  const toast = useToast();
  const rows = useQuery(async (): Promise<MenuOptionRecipe[]> => {
    const { data, error } = await supabase.from('menu_option_recipes').select('*').eq('option_id', optionId).order('created_at');
    if (error) throw error;
    return data;
  }, [optionId]);
  const [ing, setIng] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<UnitType | ''>('');
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const picked = byId.get(ing);

  const add = async () => {
    const q = Number(qty);
    if (!picked || !(q > 0)) return;
    const { error } = await supabase
      .from('menu_option_recipes')
      .upsert({ option_id: optionId, ingredient_id: picked.id, quantity: q, unit: (unit || defaultRecipeUnit(picked.unit)) as UnitType }, { onConflict: 'option_id,ingredient_id' });
    if (error) return toast.error(errorMessage(t, error));
    setIng('');
    setQty('');
    setUnit('');
    void rows.refetch();
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from('menu_option_recipes').delete().eq('id', id);
    if (error) return toast.error(errorMessage(t, error));
    void rows.refetch();
  };

  return (
    <div className="mt-2 space-y-2 rounded-btn bg-fg/[0.03] p-2">
      <p className="text-xs text-fg-3">{t('opts.ingredientsHint')}</p>
      {(rows.data ?? []).map((r) => {
        const i = byId.get(r.ingredient_id);
        return (
          <div key={r.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-fg">{i ? name(i) : '—'}</span>
            <span className="num text-fg-2">{f.number(Number(r.quantity), 3)} {t(`unit.${r.unit}`)}</span>
            <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(r.id)}>
              <Trash className="size-3.5" />
            </IconButton>
          </div>
        );
      })}
      <div className="flex flex-wrap items-end gap-2">
        <Select
          className="min-w-40 flex-1"
          aria-label={t('recipes.ingredient')}
          value={ing}
          onChange={(e) => {
            setIng(e.target.value);
            const i = byId.get(e.target.value);
            setUnit(i ? defaultRecipeUnit(i.unit) : '');
          }}
          placeholder={t('recipes.ingredient')}
          options={ingredients.filter((i) => i.is_active).map((i) => ({ value: i.id, label: name(i) }))}
        />
        <TextInput className="w-24" aria-label={t('common.quantity')} placeholder={t('common.quantity')} type="number" inputMode="decimal" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
        <Select
          className="w-24"
          aria-label={t('inventory.unit')}
          value={unit}
          onChange={(e) => setUnit(e.target.value as UnitType)}
          options={(picked ? compatibleUnits(picked.unit) : []).map((u) => ({ value: u, label: t(`unit.${u}`) }))}
        />
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => void add()} disabled={!picked || !(Number(qty) > 0)}>
          {t('opts.add')}
        </Button>
      </div>
    </div>
  );
}

/** Which kitchen printer gets the tickets for this item / category. */
export function PrinterSelect({ value, onChange, printers, label, inheritLabel }: {
  value: string | null;
  onChange: (id: string | null) => void;
  printers: Printer[];
  label: string;
  inheritLabel: string;
}) {
  return (
    <Select
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      options={[{ value: '', label: inheritLabel }, ...printers.filter((p) => p.kind === 'kitchen').map((p) => ({ value: p.id, label: p.name }))]}
    />
  );
}
