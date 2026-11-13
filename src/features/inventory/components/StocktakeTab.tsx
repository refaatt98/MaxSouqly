import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Search, Trash } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { useCosts } from '@/hooks/useCosts';
import { useAuth } from '@/app/providers/AuthProvider';
import { usePermissions } from '@/app/providers/PermissionsProvider';
import { errorMessage } from '@/lib/errors';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { useDeleteRecord, useDeleteMany } from '@/app/providers/DeleteProvider';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column, BulkBar, useSelection } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { TextInput } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import type { Ingredient, StockCount, StockCountItem } from '@/types/models';

interface Row extends StockCountItem {
  counted: string;
}

function CountEditor({ count, ingredients, onClose, onChanged }: { count: StockCount | null; ingredients: Ingredient[]; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const costs = useCosts();
  const { can } = usePermissions();
  const { f, name } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const readOnly = count?.status === 'applied';

  useEffect(() => {
    if (!count) return;
    setRows(null);
    setSearch('');
    void supabase
      .from('stock_count_items')
      .select('*')
      .eq('stock_count_id', count.id)
      .then(({ data, error }) => {
        if (error) toast.error(errorMessage(t, error));
        setRows((data ?? []).map((r) => ({ ...r, counted: r.counted_quantity === null ? '' : String(r.counted_quantity) })));
      });
  }, [count, t, toast]);

  const visible = (rows ?? []).filter((r) => {
    const ing = byId.get(r.ingredient_id);
    return !search.trim() || (ing && (ing.name_ar.includes(search.trim()) || ing.name_he.includes(search.trim())));
  });
  const done = (rows ?? []).filter((r) => r.counted !== '').length;
  const varianceValue = (rows ?? []).reduce((s, r) => {
    if (r.counted === '') return s;
    return s + (Number(r.counted) - Number(r.expected_quantity)) * (costs.ingredient(r.ingredient_id) ?? 0);
  }, 0);

  const update = (id: string, patch: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const saveDraft = async () => {
    if (!rows || !count) return false;
    const payload = rows.map((r) => ({
      id: r.id,
      stock_count_id: r.stock_count_id,
      ingredient_id: r.ingredient_id,
      expected_quantity: r.expected_quantity,
      counted_quantity: r.counted === '' ? null : Number(r.counted),
      reason: r.reason,
    }));
    const { error } = await supabase.from('stock_count_items').upsert(payload);
    if (error) {
      toast.error(errorMessage(t, error));
      return false;
    }
    return true;
  };

  const act = async (action: 'save' | 'apply' | 'discard') => {
    if (!count) return;
    setPending(action);
    try {
      if (action === 'save') {
        if (await saveDraft()) toast.success(t('common.saved'));
      } else if (action === 'apply') {
        if (!(await confirm({ title: t('count.apply'), body: t('count.applyConfirm') }))) return;
        if (!(await saveDraft())) return;
        const { data, error } = await supabase.rpc('apply_stock_count', { p_count_id: count.id });
        if (error) throw error;
        const changed = (data as { changed?: number } | null)?.changed ?? 0;
        toast.success(t('count.applied', { count: changed }));
        onChanged();
        onClose();
      } else {
        if (!(await confirm({ title: t('count.discard'), danger: true }))) return;
        const { error } = await supabase.from('stock_counts').delete().eq('id', count.id);
        if (error) throw error;
        onChanged();
        onClose();
      }
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal
      open={count !== null}
      onClose={onClose}
      size="full"
      title={t('count.title')}
      description={rows ? t('count.progress', { done: f.number(done), total: f.number(rows.length) }) : undefined}
      footer={
        readOnly ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="danger" className="me-auto" loading={pending === 'discard'} onClick={() => void act('discard')}>{t('count.discard')}</Button>
            {costs.allowed && <span className="num text-sm text-fg-2">{t('count.varianceValue')}: <b className={varianceValue < 0 ? 'text-danger' : 'text-success'}>{f.money(varianceValue)}</b></span>}
            <Button loading={pending === 'save'} onClick={() => void act('save')}>{t('count.saveDraft')}</Button>
            {can('stocktake_approve') ? (
              <Button variant="primary" loading={pending === 'apply'} onClick={() => void act('apply')}>{t('count.apply')}</Button>
            ) : (
              <span className="text-xs text-fg-3">{t('count.needsApproval')}</span>
            )}
          </>
        )
      }
    >
      <TextInput icon={<Search className="size-4" />} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3" aria-label={t('common.search')} />
      {!rows ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-fg-3">
                <th className="px-3 py-2 text-start">{t('inventory.item')}</th>
                <th className="px-3 py-2 text-start">{t('count.expected')}</th>
                <th className="px-3 py-2 text-start">{t('count.counted')}</th>
                <th className="px-3 py-2 text-start">{t('count.variance')}</th>
                <th className="px-3 py-2 text-start">{t('count.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const ing = byId.get(r.ingredient_id);
                const variance = r.counted === '' ? null : Number(r.counted) - Number(r.expected_quantity);
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-3 py-2 font-semibold">{ing ? name(ing) : t('common.unknown')}</td>
                    <td className="num px-3 py-2 text-fg-2">{f.number(Number(r.expected_quantity), 3)} {ing && t(`unit.${ing.unit}`)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={r.counted}
                        disabled={readOnly}
                        onChange={(e) => update(r.id, { counted: e.target.value })}
                        aria-label={`${t('count.counted')} ${ing?.name_ar ?? ''}`}
                        className="num h-10 w-28 rounded-btn border border-line-strong bg-surface px-2 text-center focus:border-fg-3 focus:outline-none"
                      />
                    </td>
                    <td className={cn('num px-3 py-2 font-semibold', variance === null ? 'text-fg-3' : variance < 0 ? 'text-danger' : variance > 0 ? 'text-success' : 'text-fg-2')}>
                      {variance === null ? t('common.none') : `${variance > 0 ? '+' : ''}${f.number(variance, 3)}`}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={r.reason}
                        disabled={readOnly || variance === null || variance === 0}
                        onChange={(e) => update(r.id, { reason: e.target.value.slice(0, 200) })}
                        aria-label={t('count.reason')}
                        className="h-10 w-full min-w-40 rounded-btn border border-line bg-surface px-2 focus:border-fg-3 focus:outline-none disabled:opacity-40"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

type Counted = StockCount & { creator?: { full_name: string } | null; approver?: { full_name: string } | null };

export function StocktakeTab({ ingredients, onChanged }: { ingredients: Ingredient[]; onChanged: () => void }) {
  const t = useT();
  const { role } = useAuth();
  const { f } = useSettings();
  const toast = useToast();
  const removeRecord = useDeleteRecord();
  const counts = useQuery(async () => {
    const { data, error } = await supabase
      .from('stock_counts')
      .select('*, creator:profiles!stock_counts_created_by_fkey(full_name), approver:profiles!stock_counts_applied_by_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data as unknown as (StockCount & { creator: { full_name: string } | null; approver: { full_name: string } | null })[];
  }, []);
  useLiveRefetch(['stock_counts'], counts.refetch);
  const [open, setOpen] = useState<StockCount | null>(null);
  const [creating, setCreating] = useState(false);

  const start = async () => {
    setCreating(true);
    const { data, error } = await supabase.rpc('create_stock_count', { p_notes: '' });
    setCreating(false);
    if (error) return toast.error(errorMessage(t, error));
    const { data: row } = await supabase.from('stock_counts').select('*').eq('id', data).single();
    void counts.refetch();
    if (row) setOpen(row);
  };

  const columns: Column<StockCount>[] = [
    { key: 'date', header: t('common.date'), cell: (c) => <span className="num">{f.dateTime(c.created_at)}</span> },
    { key: 'status', header: t('common.status'), cell: (c) => <Badge tone={c.status === 'applied' ? 'green' : 'amber'}>{t(`count.status.${c.status}`)}</Badge> },
    { key: 'by', header: t('count.enteredBy'), hideBelow: 'sm', cell: (c) => <span className="text-fg-2">{(c as Counted).creator?.full_name ?? '—'}</span> },
    {
      key: 'applied',
      header: t('count.apply'),
      hideBelow: 'sm',
      cell: (c) =>
        c.applied_at ? (
          <span className="text-fg-2">
            <span className="num">{f.dateTime(c.applied_at)}</span> · {(c as Counted).approver?.full_name ?? ''}
          </span>
        ) : (
          t('common.none')
        ),
    },
    {
      key: 'x',
      header: '',
      align: 'end',
      cell: (c) => (
        <IconButton
          label={t('del.button')}
          size="sm"
          className="hover:text-danger"
          onClick={(e) => {
            e.stopPropagation();
            void removeRecord('stock_count', c.id, f.dateTime(c.created_at)).then((ok) => {
              if (ok) {
                void counts.refetch();
                onChanged();
              }
            });
          }}
        >
          <Trash className="size-4" />
        </IconButton>
      ),
    },
  ];

  const sel6 = useSelection((counts.data ?? []).map((x) => x.id));
  const removeMany6 = useDeleteMany();
  const bulkDelete6 = () =>
    void removeMany6('stock_count', [...sel6.ids]).then((ok) => {
      if (ok) {
        sel6.clear();
        void counts.refetch(); onChanged();
      }
    });

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" loading={creating} onClick={() => void start()}>{t('count.new')}</Button>
      </div>
      <Card className="overflow-hidden">
        <DataTable selection={role !== 'cashier' ? sel6 : undefined}
          columns={columns}
          rows={counts.data ?? []}
          rowKey={(c) => c.id}
          loading={counts.loading && !counts.data}
          onRowClick={setOpen}
          empty={<EmptyState icon={<ClipboardCheck className="size-7" />} title={t('count.empty')} />}
        />
      </Card>
      {role !== 'cashier' && <BulkBar selection={sel6} onDelete={bulkDelete6} />}
      <CountEditor
        count={open}
        ingredients={ingredients}
        onClose={() => setOpen(null)}
        onChanged={() => {
          void counts.refetch();
          onChanged();
        }}
      />
    </>
  );
}
