import { useEffect, useState } from 'react';
import { PackageCheck, Plus, X } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { toISODate } from '@/lib/dates';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useCosts } from '@/hooks/useCosts';
import { Modal } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Input';
import type { Ingredient, Supplier } from '@/types/models';

type Line = { key: string; ingredient_id: string; quantity: string; unit_cost: string };
const blank = (): Line => ({ key: crypto.randomUUID(), ingredient_id: '', quantity: '', unit_cost: '' });

/**
 * Goods that arrived: material, quantity (in its unit), date and supplier. Stock goes up immediately.
 * Only the owner (or a 'costs' grant) sees and enters purchase prices.
 */
export function ReceiveGoodsModal({ open, ingredients, suppliers, onClose, onSaved }: {
  open: boolean;
  ingredients: Ingredient[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { name } = useSettings();
  const toast = useToast();
  const costs = useCosts();
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplier(suppliers[0]?.id ?? '');
    setDate(toISODate(new Date()));
    setNotes('');
    setLines([blank()]);
  }, [open, suppliers]);

  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const ok = lines.filter((l) => l.ingredient_id && Number(l.quantity) > 0);

  const save = async () => {
    if (!supplier) return toast.error(t('errors.SUPPLIER_REQUIRED'));
    if (ok.length === 0) return toast.error(t('po.noLines'));
    setPending(true);
    const { error } = await supabase.rpc('receive_goods', {
      p_lines: ok.map((l) => ({
        ingredient_id: l.ingredient_id,
        quantity: Number(l.quantity),
        ...(costs.allowed && l.unit_cost !== '' ? { unit_cost: Number(l.unit_cost) } : {}),
      })),
      p_supplier_id: supplier,
      p_date: date,
      p_notes: notes.trim(),
    });
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('recv.done', { count: ok.length }));
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('recv.title')}
      description={t('recv.hint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={<PackageCheck className="size-4" />} loading={pending} onClick={() => void save()}>
            {t('recv.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('po.supplier')} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="—" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          <TextInput label={t('recv.date')} type="date" value={date} max={toISODate(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <TextInput label={t('common.notes')} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="space-y-2">
          {lines.map((l) => {
            const ing = byId.get(l.ingredient_id);
            return (
              <div key={l.key} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-card border border-line bg-card p-3 sm:grid-cols-[2fr_1fr_auto_auto]">
                <Select
                  className="col-span-2 sm:col-span-1"
                  label={t('recipes.ingredient')}
                  value={l.ingredient_id}
                  onChange={(e) => update(l.key, { ingredient_id: e.target.value, unit_cost: costs.allowed ? String(costs.ingredient(e.target.value) ?? '') : '' })}
                  placeholder="—"
                  options={ingredients.filter((i) => i.is_active).map((i) => ({ value: i.id, label: name(i) }))}
                />
                <TextInput label={t('common.quantity')} type="number" inputMode="decimal" min={0} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} suffix={ing ? t(`unit.${ing.unit}`) : undefined} />
                {costs.allowed ? (
                  <TextInput label={t('po.unitCost')} type="number" inputMode="decimal" min={0} step="0.01" value={l.unit_cost} onChange={(e) => update(l.key, { unit_cost: e.target.value })} className="w-28" />
                ) : (
                  <span />
                )}
                <IconButton label={t('common.delete')} className="mb-0.5 hover:text-danger" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}>
                  <X className="size-4" />
                </IconButton>
              </div>
            );
          })}
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, blank()])}>
          {t('po.addLine')}
        </Button>
      </div>
    </Modal>
  );
}
