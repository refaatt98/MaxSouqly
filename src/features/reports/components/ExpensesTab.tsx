import { useEffect, useMemo, useState } from 'react';
import { Paperclip, Receipt, Trash } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { deleteImage } from '@/lib/r2';
import { toISODate } from '@/lib/dates';
import { hasErrors, v, type Errors } from '@/lib/validation';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { ShareBars } from '@/components/ui/Chart';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ImageUploader, useImageField } from '@/components/ui/ImageUploader';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from '@/types/models';
import type { ExportSpec, RegisterExport } from './ReportTabs';

type Field = 'category' | 'amount' | 'expense_date' | 'note';

function ExpenseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const receipt = useImageField(null);
  const [form, setForm] = useState<Record<Field, string>>({ category: 'supplies', amount: '', expense_date: toISODate(new Date()), note: '' });
  const [errors, setErrors] = useState<Errors<Field>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ category: 'supplies', amount: '', expense_date: toISODate(new Date()), note: '' });
    setErrors({});
    receipt.reset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    const e: Errors<Field> = { amount: v.number(t, form.amount, { positive: true, max: 10_000_000 }), expense_date: v.required(t, form.expense_date), note: v.maxLen(t, form.note, 300) };
    setErrors(e);
    if (hasErrors(e)) return;
    setPending(true);
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.from('expenses').insert({
      category: form.category as ExpenseCategory,
      amount: Number(form.amount),
      expense_date: form.expense_date,
      note: form.note.trim(),
      receipt_url: receipt.url,
      user_id: sess.session?.user.id ?? null,
    });
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    await receipt.commit();
    toast.success(t('common.saved'));
    onSaved();
  };
  const cancel = () => {
    void receipt.discard();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      title={t('reports.newExpense')}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label={t('menu.category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`expense.${c}`) }))} />
        <TextInput label={t('common.amount')} type="number" inputMode="decimal" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={errors.amount} suffix="₪" required data-autofocus />
        <TextInput className="sm:col-span-2" label={t('common.date')} type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} error={errors.expense_date} />
        <Textarea className="sm:col-span-2" label={t('common.notes')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={errors.note} rows={2} />
        <ImageUploader className="sm:col-span-2" label={t('reports.receipt')} value={receipt.url} onChange={receipt.setUrl} folder="receipts" />
      </div>
    </Modal>
  );
}

export function ExpensesTab({ from, to, register }: { from: string; to: string; register: RegisterExport }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const expenses = useQuery(async () => {
    const { data, error } = await supabase.from('expenses').select('*').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }, [from, to]);
  useLiveRefetch(['expenses'], expenses.refetch);
  const rows = useMemo(() => expenses.data ?? [], [expenses.data]);
  const total = rows.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = useMemo(() => {
    const m = new Map<ExpenseCategory, number>();
    for (const e of rows) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const spec = useMemo<ExportSpec | null>(
    () =>
      expenses.data
        ? {
            title: t('reports.expenses'),
            sections: [
              { heading: t('reports.expenses'), kpis: [[t('reports.expensesTotal'), f.money(total)]] },
              { heading: t('reports.expensesByCategory'), table: { headers: [t('menu.category'), t('common.amount')], rows: byCategory.map(([c, a]) => [t(`expense.${c}`), f.money(a)]) } },
              { heading: t('reports.expenses'), table: { headers: [t('common.date'), t('menu.category'), t('common.notes'), t('common.amount')], rows: rows.map((e) => [f.date(e.expense_date), t(`expense.${e.category}`), e.note, f.money(Number(e.amount))]) } },
            ],
            csv: { headers: [t('common.date'), t('menu.category'), t('common.notes'), t('common.amount')], rows: rows.map((e) => [e.expense_date, t(`expense.${e.category}`), e.note, Number(e.amount)]) },
          }
        : null,
    [expenses.data, rows, byCategory, total, t, f],
  );
  useEffect(() => register(spec), [register, spec]);

  const remove = async (e: Expense) => {
    if (!(await confirm({ title: t('common.delete'), body: `${t(`expense.${e.category}`)} — ${f.money(Number(e.amount))}`, danger: true }))) return;
    const { error } = await supabase.from('expenses').delete().eq('id', e.id);
    if (error) return toast.error(errorMessage(t, error));
    void deleteImage(e.receipt_url);
    void expenses.refetch();
  };

  const columns: Column<Expense>[] = [
    { key: 'd', header: t('common.date'), cell: (e) => <span className="num">{f.date(e.expense_date)}</span> },
    { key: 'c', header: t('menu.category'), cell: (e) => <span className="text-fg-2">{t(`expense.${e.category}`)}</span> },
    { key: 'n', header: t('common.notes'), hideBelow: 'sm', cell: (e) => <span className="text-fg-2">{e.note || t('common.none')}</span> },
    { key: 'a', header: t('common.amount'), cell: (e) => <span className="num font-semibold">{f.money(Number(e.amount))}</span> },
    {
      key: 'x',
      header: '',
      align: 'end',
      cell: (e) => (
        <div className="flex justify-end">
          {e.receipt_url && <IconButton label={t('reports.receipt')} size="sm" onClick={() => setViewing(e.receipt_url)}><Paperclip className="size-4" /></IconButton>}
          <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(e)}><Trash className="size-4" /></IconButton>
        </div>
      ),
    },
  ];

  if (expenses.error && !expenses.data) return <ErrorState message={errorMessage(t, expenses.error)} onRetry={() => void expenses.refetch()} retryLabel={t('common.retry')} />;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="overflow-hidden xl:col-span-2">
        <CardHeader title={t('reports.expenses')} subtitle={f.money(total)} actions={<Button variant="primary" onClick={() => setAdding(true)}>{t('reports.addExpense')}</Button>} className="pb-3" />
        <DataTable columns={columns} rows={rows} rowKey={(e) => e.id} loading={expenses.loading && !expenses.data} empty={<EmptyState icon={<Receipt className="size-7" />} title={t('reports.expensesEmpty')} />} />
      </Card>
      <Card className="h-fit">
        <CardHeader title={t('reports.expensesByCategory')} />
        <div className="p-5">
          {byCategory.length ? (
            <ShareBars format={f.money} items={byCategory.map(([c, a]) => ({ label: t(`expense.${c}`), value: a, color: '#5c5750' }))} />
          ) : (
            <p className="text-sm text-fg-3">{t('reports.expensesEmpty')}</p>
          )}
        </div>
      </Card>
      <ExpenseModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void expenses.refetch(); }} />
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={t('reports.receipt')} size="lg">
        {viewing && <img src={viewing} alt={t('reports.receipt')} className="mx-auto max-h-[70dvh] rounded-card" />}
      </Modal>
    </div>
  );
}
