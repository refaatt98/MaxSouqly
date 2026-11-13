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
import type { MenuItemOption, Printer } from '@/types/models';

/** Extras a customer can add to one menu item (cheese, sauce…), each with its own price. Saved as you go. */
export function OptionsEditor({ menuItemId }: { menuItemId: string }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const list = useQuery(async (): Promise<MenuItemOption[]> => {
    const { data, error } = await supabase.from('menu_item_options').select('*').eq('menu_item_id', menuItemId).order('sort_order').order('created_at');
    if (error) throw error;
    return data;
  }, [menuItemId]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  const add = async () => {
    const n = name.trim();
    const p = Number(price || 0);
    if (!n || !Number.isFinite(p) || p < 0) return;
    const { error } = await supabase
      .from('menu_item_options')
      .insert({ menu_item_id: menuItemId, name_ar: n, price: p, sort_order: (list.data?.length ?? 0) + 1 });
    if (error) return toast.error(errorMessage(t, error));
    setName('');
    setPrice('');
    void list.refetch();
  };
  const patch = async (o: MenuItemOption, row: Partial<Pick<MenuItemOption, 'is_active' | 'price' | 'name_ar'>>) => {
    list.setData((d = []) => d.map((x) => (x.id === o.id ? { ...x, ...row } : x)));
    const { error } = await supabase.from('menu_item_options').update(row).eq('id', o.id);
    if (error) {
      toast.error(errorMessage(t, error));
      void list.refetch();
    }
  };
  const remove = async (o: MenuItemOption) => {
    const { error } = await supabase.from('menu_item_options').delete().eq('id', o.id);
    if (error) return toast.error(errorMessage(t, error));
    void list.refetch();
  };

  return (
    <section className="rounded-card border border-line bg-card p-3">
      <h3 className="text-sm text-fg">{t('opts.title')}</h3>
      <p className="mb-3 text-xs text-fg-3">{t('opts.hint')}</p>
      <ul className="space-y-2">
        {(list.data ?? []).map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <input
              defaultValue={o.name_ar}
              aria-label={t('common.name')}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== o.name_ar && void patch(o, { name_ar: e.target.value.trim() })}
              className="h-10 min-w-0 flex-1 rounded-btn border border-line-strong bg-surface px-3 text-sm focus:border-fg-3 focus:outline-none"
            />
            <input
              defaultValue={String(o.price)}
              type="number"
              inputMode="decimal"
              min={0}
              aria-label={t('common.price')}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v !== Number(o.price)) void patch(o, { price: v });
              }}
              className="num h-10 w-20 rounded-btn border border-line-strong bg-surface px-2 text-center text-sm focus:border-fg-3 focus:outline-none"
            />
            <Toggle id={`opt-${o.id}`} checked={o.is_active} onChange={(v) => void patch(o, { is_active: v })} label="" />
            <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(o)}>
              <Trash className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-end gap-2">
        <TextInput className="flex-1" placeholder={t('opts.namePlaceholder')} aria-label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <TextInput className="w-24" placeholder="0" aria-label={t('common.price')} type="number" inputMode="decimal" min={0} value={price} onChange={(e) => setPrice(e.target.value)} suffix={f.money(0).replace(/[0-9.,\s]/g, '')} />
        <Button icon={<Plus className="size-4" />} onClick={() => void add()} disabled={!name.trim()}>
          {t('opts.add')}
        </Button>
      </div>
    </section>
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
