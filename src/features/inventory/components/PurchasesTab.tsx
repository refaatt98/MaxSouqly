import { useEffect, useMemo, useState } from 'react';
import { PackageCheck, Plus, Send, ShoppingBag, Trash, X } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { round2 } from '@/lib/format';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import type { Ingredient, PoStatus, PurchaseOrder, PurchaseOrderItem, Supplier } from '@/types/models';
import { stockLevel } from '../api';

const STATUS_TONE: Record<PoStatus, Tone> = { draft: 'neutral', sent: 'blue', received: 'green', cancelled: 'red' };

interface Line {
  key: string;
  ingredient_id: string;
  quantity: string;
  unit_cost: string;
}

async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}

function PoEditor({ po, suppliers, ingredients, onClose, onChanged }: {
  po: PurchaseOrder | 'new' | null;
  suppliers: Supplier[];
  ingredients: Ingredient[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { f, name } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const existing = po !== null && po !== 'new' ? po : null;
  const editable = !existing || existing.status === 'draft';
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const ingredientMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  useEffect(() => {
    if (po === null) return;
    setError(null);
    setSupplierId(existing?.supplier_id ?? suppliers[0]?.id ?? '');
    setExpected(existing?.expected_date ?? '');
    setNotes(existing?.notes ?? '');
    setLines([]);
    if (existing) {
      void supabase
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', existing.id)
        .then(({ data }) =>
          setLines(
            (data ?? []).map((l: PurchaseOrderItem) => ({ key: l.id, ingredient_id: l.ingredient_id, quantity: String(l.quantity), unit_cost: String(l.unit_cost) })),
          ),
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po]);

  const addLine = (ingredientId = '') => {
    const ing = ingredientMap.get(ingredientId);
    setLines((ls) => [...ls, { key: crypto.randomUUID(), ingredient_id: ingredientId, quantity: '', unit_cost: ing ? String(ing.cost_per_unit) : '' }]);
  };
  const suggestLow = () => {
    const low = ingredients.filter((i) => i.is_active && stockLevel(i) !== 'ok' && (!supplierId || i.supplier_id === supplierId) && !lines.some((l) => l.ingredient_id === i.id));
    setLines((ls) => [
      ...ls,
      ...low.map((i) => ({
        key: crypto.randomUUID(),
        ingredient_id: i.id,
        quantity: String(Math.max(1, Math.ceil(Number(i.min_quantity) * 2 - Number(i.quantity)))),
        unit_cost: String(i.cost_per_unit),
      })),
    ]);
  };
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0));

  const validLines = () => {
    const ok = lines.filter((l) => l.ingredient_id && Number(l.quantity) > 0 && Number(l.unit_cost) >= 0);
    if (ok.length === 0 || ok.length !== lines.length) {
      setError(t('po.noLines'));
      return null;
    }
    return ok;
  };

  /** Saves the draft (header + lines). Returns the PO id. */
  const saveDraft = async (): Promise<string | null> => {
    const ok = validLines();
    if (!ok || !supplierId) return null;
    const header = { supplier_id: supplierId, expected_date: expected || null, notes: notes.trim() };
    let id = existing?.id;
    if (id) {
      const { error: e } = await supabase.from('purchase_orders').update(header).eq('id', id);
      if (e) throw e;
      const { error: d } = await supabase.from('purchase_order_items').delete().eq('purchase_order_id', id);
      if (d) throw d;
    } else {
      const { data, error: e } = await supabase.from('purchase_orders').insert({ ...header, status: 'draft' }).select('id').single();
      if (e) throw e;
      id = data.id;
    }
    const { error: li } = await supabase
      .from('purchase_order_items')
      .insert(ok.map((l) => ({ purchase_order_id: id as string, ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })));
    if (li) throw li;
    return id ?? null;
  };

  const run = async (action: 'save' | 'send' | 'receive' | 'cancel') => {
    setError(null);
    setPending(action);
    try {
      if (action === 'save') {
        if (!(await saveDraft())) return;
        toast.success(t('common.saved'));
      } else if (action === 'send') {
        const id = editable ? await saveDraft() : existing?.id;
        if (!id) return;
        const { error: e } = await supabase.from('purchase_orders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
        if (e) throw e;
        toast.success(t('common.saved'));
      } else if (action === 'receive') {
        if (!(await confirm({ title: t('po.receive'), body: t('po.receiveConfirm') }))) return;
        const id = editable ? await saveDraft() : existing?.id;
        if (!id) return;
        const { error: e } = await supabase.rpc('receive_purchase_order', { p_po_id: id });
        if (e) throw e;
        toast.success(t('po.received'));
      } else if (existing) {
        if (!(await confirm({ title: t('po.cancelPo'), danger: true }))) return;
        const { error: e } = await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', existing.id);
        if (e) throw e;
      }
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(null);
    }
  };

  const open = po !== null;
  const canReceive = !existing || existing.status === 'draft' || existing.status === 'sent';
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={existing ? t('po.number', { number: f.digits(existing.po_number) }) : t('po.new')}
      description={existing ? <Badge tone={STATUS_TONE[existing.status]}>{t(`po.status.${existing.status}`)}</Badge> : undefined}
      footer={
        <>
          {existing && canReceive && (
            <Button variant="danger" className="me-auto" loading={pending === 'cancel'} onClick={() => void run('cancel')}>{t('po.cancelPo')}</Button>
          )}
          {editable && <Button loading={pending === 'save'} onClick={() => void run('save')}>{t('count.saveDraft')}</Button>}
          {editable && <Button variant="outline" icon={<Send className="size-4 rtl:-scale-x-100" />} loading={pending === 'send'} onClick={() => void run('send')}>{t('po.send')}</Button>}
          {canReceive && <Button variant="success" icon={<PackageCheck className="size-4" />} loading={pending === 'receive'} onClick={() => void run('receive')}>{t('po.receive')}</Button>}
          {!canReceive && <Button onClick={onClose}>{t('common.close')}</Button>}
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Select label={t('po.supplier')} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} disabled={!editable} required />
        <TextInput label={t('po.expectedDate')} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} disabled={!editable} />
        <Textarea label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} disabled={!editable} />
      </div>
      <div className="mt-5 mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{t('po.lines')}</h3>
        {editable && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={suggestLow}>{t('po.suggestLow')}</Button>
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => addLine()}>{t('po.addLine')}</Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {lines.map((l) => {
          const ing = ingredientMap.get(l.ingredient_id);
          return (
            <div key={l.key} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-card border border-line bg-card p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <Select
                className="col-span-2 md:col-span-1"
                label={t('recipes.ingredient')}
                value={l.ingredient_id}
                onChange={(e) => update(l.key, { ingredient_id: e.target.value, unit_cost: String(ingredientMap.get(e.target.value)?.cost_per_unit ?? '') })}
                placeholder="—"
                options={ingredients.map((i) => ({ value: i.id, label: name(i) }))}
                disabled={!editable}
              />
              <TextInput label={t('common.quantity')} type="number" inputMode="decimal" min={0} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} suffix={ing ? t(`unit.${ing.unit}`) : undefined} disabled={!editable} />
              <TextInput label={t('po.unitCost')} type="number" inputMode="decimal" min={0} step="0.01" value={l.unit_cost} onChange={(e) => update(l.key, { unit_cost: e.target.value })} disabled={!editable} />
              <div className="pb-2.5">
                <p className="text-xs text-fg-3">{t('po.lineTotal')}</p>
                <p className="num font-semibold">{f.money((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0))}</p>
              </div>
              {editable && (
                <IconButton label={t('common.delete')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="hover:text-danger">
                  <X className="size-4" />
                </IconButton>
              )}
            </div>
          );
        })}
        {lines.length === 0 && <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-fg-3">{t('po.noLines')}</p>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-3 text-lg font-semibold">
        <span>{t('common.total')}</span>
        <span className="num">{f.money(total)}</span>
      </div>
    </Modal>
  );
}

export function PurchasesTab({ suppliers, ingredients, newRequest, onNewHandled, onChanged }: {
  suppliers: Supplier[];
  ingredients: Ingredient[];
  newRequest: boolean;
  onNewHandled: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const orders = useQuery(fetchPurchaseOrders, []);
  useLiveRefetch(['purchase_orders', 'purchase_order_items'], orders.refetch);
  const [edit, setEdit] = useState<PurchaseOrder | 'new' | null>(null);
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  useEffect(() => {
    if (newRequest) {
      setEdit('new');
      onNewHandled();
    }
  }, [newRequest, onNewHandled]);

  const removeDraft = async (po: PurchaseOrder) => {
    if (!(await confirm({ title: t('common.delete'), body: t('po.number', { number: po.po_number }), danger: true }))) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id);
    if (error) return toast.error(errorMessage(t, error));
    void orders.refetch();
  };

  const columns: Column<PurchaseOrder>[] = [
    { key: 'num', header: '#', cell: (p) => <span className="num font-semibold">#{f.digits(p.po_number)}</span> },
    { key: 'supplier', header: t('po.supplier'), cell: (p) => supplierName.get(p.supplier_id) ?? t('common.unknown') },
    { key: 'date', header: t('common.date'), hideBelow: 'sm', cell: (p) => <span className="num text-fg-2">{f.dateTime(p.created_at)}</span> },
    { key: 'expected', header: t('po.expectedDate'), hideBelow: 'md', cell: (p) => (p.expected_date ? f.date(p.expected_date) : t('common.none')) },
    { key: 'status', header: t('common.status'), cell: (p) => <Badge tone={STATUS_TONE[p.status]}>{t(`po.status.${p.status}`)}</Badge> },
    { key: 'total', header: t('common.total'), align: 'end', cell: (p) => <span className="num font-semibold">{f.money(Number(p.total))}</span> },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (p) =>
        p.status === 'draft' ? (
          <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={(e) => { e.stopPropagation(); void removeDraft(p); }}>
            <Trash className="size-4" />
          </IconButton>
        ) : null,
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" onClick={() => setEdit('new')}>{t('inventory.newPurchase')}</Button>
      </div>
      <Card className="overflow-hidden">
        {orders.error && !orders.data ? (
          <ErrorState message={errorMessage(t, orders.error)} onRetry={() => void orders.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <DataTable
            columns={columns}
            rows={orders.data ?? []}
            rowKey={(p) => p.id}
            loading={orders.loading && !orders.data}
            onRowClick={(p) => setEdit(p)}
            empty={<EmptyState icon={<ShoppingBag className="size-7" />} title={t('po.empty')} />}
          />
        )}
      </Card>
      <PoEditor
        po={edit}
        suppliers={suppliers}
        ingredients={ingredients}
        onClose={() => setEdit(null)}
        onChanged={() => {
          void orders.refetch();
          onChanged();
        }}
      />
    </>
  );
}
