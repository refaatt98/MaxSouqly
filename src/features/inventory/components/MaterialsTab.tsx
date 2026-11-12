import { useEffect, useMemo, useState } from 'react';
import { Boxes, ClipboardList, Pencil, Search, SlidersHorizontal, Trash } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { deleteImage } from '@/lib/r2';
import { hasErrors, v, type Errors } from '@/lib/validation';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useDeleteRecord } from '@/app/providers/DeleteProvider';
import { useAuth } from '@/app/providers/AuthProvider';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Drawer, Modal } from '@/components/ui/Modal';
import { Select, TextInput } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ImageUploader, useImageField } from '@/components/ui/ImageUploader';
import { UNITS, type Ingredient, type StockMovement, type Supplier, type UnitType } from '@/types/models';
import { LEVEL_TONE, stockLevel } from '../api';
import type { QueryState } from '@/hooks/useQuery';

type Field = 'name_ar' | 'name_he' | 'unit' | 'quantity' | 'min_quantity' | 'cost_per_unit' | 'supplier_id';

function MaterialModal({ material, suppliers, onClose, onSaved }: { material: Ingredient | 'new' | null; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const editing = material !== null && material !== 'new' ? material : null;
  const image = useImageField(editing?.image_url ?? null);
  const [form, setForm] = useState<Record<Field, string>>({ name_ar: '', name_he: '', unit: 'kg', quantity: '0', min_quantity: '0', cost_per_unit: '0', supplier_id: '' });
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Errors<Field>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (material === null) return;
    setForm({
      name_ar: editing?.name_ar ?? '',
      name_he: editing?.name_he ?? '',
      unit: editing?.unit ?? 'kg',
      quantity: String(editing?.quantity ?? 0),
      min_quantity: String(editing?.min_quantity ?? 0),
      cost_per_unit: String(editing?.cost_per_unit ?? 0),
      supplier_id: editing?.supplier_id ?? '',
    });
    setActive(editing?.is_active ?? true);
    setErrors({});
    image.reset(editing?.image_url ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  const set = (k: Field, value: string) => setForm((s) => ({ ...s, [k]: value }));

  const save = async () => {
    const e: Errors<Field> = {
      name_ar: v.required(t, form.name_ar) ?? v.maxLen(t, form.name_ar, 80),
      quantity: editing ? null : v.number(t, form.quantity, { min: 0 }),
      min_quantity: v.number(t, form.min_quantity, { min: 0 }),
      cost_per_unit: v.number(t, form.cost_per_unit, { min: 0 }),
    };
    setErrors(e);
    if (hasErrors(e)) return;
    setPending(true);
    const base = {
      name_ar: form.name_ar.trim(),
      name_he: form.name_he.trim(),
      unit: form.unit as UnitType,
      min_quantity: Number(form.min_quantity),
      cost_per_unit: Number(form.cost_per_unit),
      supplier_id: form.supplier_id || null,
      image_url: image.url,
      is_active: active,
    };
    // quantity is only set on creation; afterwards it changes through audited movements
    const { error } = editing
      ? await supabase.from('ingredients').update(base).eq('id', editing.id)
      : await supabase.from('ingredients').insert({ ...base, quantity: Number(form.quantity) });
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    await image.commit();
    toast.success(t('common.saved'));
    onSaved();
  };

  const cancel = () => {
    void image.discard();
    onClose();
  };

  return (
    <Modal
      open={material !== null}
      onClose={cancel}
      title={editing ? t('inventory.editMaterial') : t('inventory.newMaterial')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label={t('common.nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} error={errors.name_ar} required data-autofocus />
        <TextInput label={t('common.nameHe')} value={form.name_he} onChange={(e) => set('name_he', e.target.value)} lang="he" />
        <Select label={t('inventory.unit')} value={form.unit} onChange={(e) => set('unit', e.target.value)} options={UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }))} />
        <Select label={t('inventory.supplier')} value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)} placeholder={t('common.none')} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        {!editing && <TextInput label={t('inventory.initialQty')} type="number" inputMode="decimal" min={0} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} error={errors.quantity} />}
        <TextInput label={t('inventory.minQty')} type="number" inputMode="decimal" min={0} value={form.min_quantity} onChange={(e) => set('min_quantity', e.target.value)} error={errors.min_quantity} />
        <TextInput label={t('inventory.costPerUnit')} type="number" inputMode="decimal" min={0} step="0.01" value={form.cost_per_unit} onChange={(e) => set('cost_per_unit', e.target.value)} error={errors.cost_per_unit} suffix="₪" />
        <ImageUploader className="md:col-span-2" value={image.url} onChange={image.setUrl} folder="ingredients" />
        <Toggle id="mat-active" label={t('common.active')} checked={active} onChange={setActive} />
      </div>
    </Modal>
  );
}

function AdjustModal({ material, onClose, onSaved }: { material: Ingredient | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const [mode, setMode] = useState<'add' | 'remove' | 'waste'>('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ qty?: string | null; note?: string | null }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setMode('add');
    setQty('');
    setNote('');
    setErrors({});
  }, [material]);

  if (!material) return null;
  const save = async () => {
    const e = { qty: v.number(t, qty, { positive: true }), note: v.minLen(t, note, 2) };
    setErrors(e);
    if (e.qty || e.note) return;
    const change = mode === 'add' ? Number(qty) : -Number(qty);
    setPending(true);
    const { error } = await supabase.rpc('adjust_stock', { p_ingredient_id: material.id, p_change: change, p_reason: mode === 'waste' ? 'waste' : 'adjustment', p_note: note.trim() });
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('common.saved'));
    onSaved();
  };
  const after = Number(material.quantity) + (mode === 'add' ? 1 : -1) * (Number(qty) || 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('inventory.adjustTitle', { name: material.name_ar })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          className="w-full"
          layoutId="adj-mode"
          value={mode}
          onChange={setMode}
          items={[
            { key: 'add', label: t('inventory.adjustAdd') },
            { key: 'remove', label: t('inventory.adjustRemove') },
            { key: 'waste', label: t('inventory.adjustWaste') },
          ]}
        />
        <TextInput label={t('common.quantity')} type="number" inputMode="decimal" min={0} value={qty} onChange={(e) => setQty(e.target.value)} error={errors.qty} suffix={t(`unit.${material.unit}`)} data-autofocus />
        <TextInput label={t('inventory.adjustReason')} value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} required />
        <p className="text-sm text-fg-3">
          {t('inventory.currentQty')}: <span className="num text-fg">{f.number(Number(material.quantity), 3)}</span> → {t('inventory.after')}:{' '}
          <span className={`num font-semibold ${after < 0 ? 'text-danger' : 'text-fg'}`}>{f.number(after, 3)}</span>
        </p>
      </div>
    </Modal>
  );
}

function HistoryDrawer({ material, onClose }: { material: Ingredient | null; onClose: () => void }) {
  const t = useT();
  const { f } = useSettings();
  const history = useQuery(
    async () => {
      if (!material) return [] as StockMovement[];
      const { data, error } = await supabase.from('stock_movements').select('*').eq('ingredient_id', material.id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
    [material?.id],
    { enabled: material !== null },
  );
  useLiveRefetch(material ? ['stock_movements'] : [], history.refetch);
  const removeRecord = useDeleteRecord();
  const { role } = useAuth();
  const canDelete = role === 'owner' || role === 'manager' || role === 'inventory';
  const tone = { sale: 'neutral', purchase: 'green', adjustment: 'blue', waste: 'red', void: 'gold' } as const;
  return (
    <Drawer open={material !== null} onClose={onClose} title={material ? t('inventory.historyTitle', { name: material.name_ar }) : ''}>
      {history.loading ? (
        <SkeletonRows rows={8} />
      ) : (history.data ?? []).length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-7" />} title={t('inventory.noMovements')} />
      ) : (
        <ul className="divide-y divide-line">
          {(history.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <Badge tone={tone[m.reason]}>{t(`inventory.reason.${m.reason}`)}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{m.note || t('common.none')}</p>
                <p className="num text-xs text-fg-3">{f.dateTime(m.created_at)}</p>
              </div>
              <div className="text-end">
                <p className={`num font-semibold ${Number(m.change) >= 0 ? 'text-success' : 'text-danger'}`}>
                  {Number(m.change) >= 0 ? '+' : ''}
                  {f.number(Number(m.change), 3)}
                </p>
                <p className="num text-xs text-fg-3">{t('inventory.after')} {f.number(Number(m.quantity_after), 3)}</p>
              </div>
              {canDelete && !m.ref_id && (m.reason === 'adjustment' || m.reason === 'waste') && (
                <IconButton
                  label={t('del.button')}
                  size="sm"
                  className="hover:text-danger"
                  onClick={() => void removeRecord('stock_movement', m.id, material?.name_ar ?? '').then((ok) => ok && void history.refetch())}
                >
                  <Trash className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function MaterialsTab({ ingredients, suppliers, lowOnly: initialLow, onNewPurchase }: {
  ingredients: QueryState<Ingredient[]>;
  suppliers: Supplier[];
  lowOnly: boolean;
  onNewPurchase: () => void;
}) {
  const t = useT();
  const { f, name } = useSettings();
  const { role } = useAuth();
  const removeRecord = useDeleteRecord();
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(initialLow);
  const [edit, setEdit] = useState<Ingredient | 'new' | null>(null);
  const [adjust, setAdjust] = useState<Ingredient | null>(null);
  const [history, setHistory] = useState<Ingredient | null>(null);
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (ingredients.data ?? []).filter(
      (i) => (!needle || i.name_ar.toLowerCase().includes(needle) || i.name_he.toLowerCase().includes(needle)) && (!lowOnly || stockLevel(i) !== 'ok'),
    );
  }, [ingredients.data, search, lowOnly]);
  const lowCount = (ingredients.data ?? []).filter((i) => i.is_active && stockLevel(i) !== 'ok').length;

  const remove = async (i: Ingredient) => {
    if (!(await removeRecord('ingredient', i.id, i.name_ar))) return;
    void deleteImage(i.image_url);
    void ingredients.refetch();
  };

  const columns: Column<Ingredient>[] = [
    {
      key: 'name',
      header: t('inventory.item'),
      cell: (i) => (
        <div className="flex items-center gap-3">
          {i.image_url ? (
            <img src={i.image_url} alt="" className="size-10 rounded-btn object-cover" />
          ) : (
            <span className="grid size-10 place-items-center rounded-btn bg-fg/5 text-fg-3"><Boxes className="size-5" /></span>
          )}
          <div>
            <p className="text-fg">{name(i)}</p>
            <p className="text-xs text-fg-3">{i.supplier_id ? supplierName.get(i.supplier_id) : t('common.none')}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'qty',
      header: t('inventory.currentQty'),
      cell: (i) => (
        <span className="num font-semibold">
          {f.number(Number(i.quantity), 3)} <span className="text-xs font-normal text-fg-3">{t(`unit.${i.unit}`)}</span>
        </span>
      ),
    },
    { key: 'min', header: t('inventory.minQty'), hideBelow: 'sm', cell: (i) => <span className="num text-fg-2">{f.number(Number(i.min_quantity), 3)}</span> },
    { key: 'cost', header: t('inventory.costPerUnit'), hideBelow: 'md', cell: (i) => <span className="num text-fg-2">{f.money(Number(i.cost_per_unit))}</span> },
    { key: 'value', header: t('inventory.value'), hideBelow: 'lg', cell: (i) => <span className="num">{f.money(Math.max(0, Number(i.quantity)) * Number(i.cost_per_unit))}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (i) => {
        const lvl = stockLevel(i);
        return <Badge tone={LEVEL_TONE[lvl]} dot>{t(`inventory.status.${lvl}`)}</Badge>;
      },
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'end',
      cell: (i) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <IconButton label={t('inventory.adjust')} size="sm" onClick={() => setAdjust(i)}><SlidersHorizontal className="size-4" /></IconButton>
          <IconButton label={t('inventory.history')} size="sm" onClick={() => setHistory(i)}><ClipboardList className="size-4" /></IconButton>
          <IconButton label={t('common.edit')} size="sm" onClick={() => setEdit(i)}><Pencil className="size-4" /></IconButton>
          {(role === 'owner' || role === 'manager') && (
            <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(i)}><Trash className="size-4" /></IconButton>
          )}
        </div>
      ),
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      'max-inventory',
      [t('inventory.item'), t('inventory.unit'), t('inventory.currentQty'), t('inventory.minQty'), t('inventory.costPerUnit'), t('inventory.value'), t('common.status')],
      rows.map((i) => [i.name_ar, t(`unit.${i.unit}`), Number(i.quantity), Number(i.min_quantity), Number(i.cost_per_unit), Math.max(0, Number(i.quantity)) * Number(i.cost_per_unit), t(`inventory.status.${stockLevel(i)}`)]),
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput icon={<Search className="size-4" />} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-60 flex-1" aria-label={t('common.search')} />
        <Button variant={lowOnly ? 'danger' : 'outline'} onClick={() => setLowOnly((x) => !x)}>
          {t('inventory.filterLow')} {lowCount > 0 && <span className="num">({f.number(lowCount)})</span>}
        </Button>
        <Button onClick={exportCsv}>{t('common.export')}</Button>
        <Button onClick={onNewPurchase}>{t('inventory.newPurchase')}</Button>
        <Button variant="primary" onClick={() => setEdit('new')}>{t('inventory.addMaterial')}</Button>
      </div>
      <Card className="overflow-hidden">
        {ingredients.error && !ingredients.data ? (
          <ErrorState message={errorMessage(t, ingredients.error)} onRetry={() => void ingredients.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(i) => i.id}
            loading={ingredients.loading && !ingredients.data}
            onRowClick={(i) => setHistory(i)}
            rowClassName={(i) => (i.is_active ? undefined : 'opacity-50')}
            empty={<EmptyState icon={<Boxes className="size-7" />} title={t('inventory.empty')} />}
          />
        )}
      </Card>
      <MaterialModal material={edit} suppliers={suppliers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void ingredients.refetch(); }} />
      <AdjustModal material={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); void ingredients.refetch(); }} />
      <HistoryDrawer material={history} onClose={() => setHistory(null)} />
    </>
  );
}
