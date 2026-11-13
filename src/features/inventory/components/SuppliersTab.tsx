import { useEffect, useState } from 'react';
import { Mail, MapPin, Pencil, Phone, Trash, Truck } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { hasErrors, v, type Errors } from '@/lib/validation';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useDeleteMany, useDeleteRecord } from '@/app/providers/DeleteProvider';
import { BulkBar, SelectBox, useSelection } from '@/components/ui/Table';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextInput, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { QueryState } from '@/hooks/useQuery';
import type { Ingredient, Supplier } from '@/types/models';

type Field = 'name' | 'contact_name' | 'phone' | 'email' | 'address' | 'notes';
const EMPTY: Record<Field, string> = { name: '', contact_name: '', phone: '', email: '', address: '', notes: '' };

function SupplierModal({ supplier, onClose, onSaved }: { supplier: Supplier | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const editing = supplier !== null && supplier !== 'new' ? supplier : null;
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors<Field>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (supplier === null) return;
    setForm(editing ? { name: editing.name, contact_name: editing.contact_name, phone: editing.phone, email: editing.email, address: editing.address, notes: editing.notes } : EMPTY);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier]);

  const set = (k: Field, value: string) => setForm((s) => ({ ...s, [k]: value }));
  const save = async () => {
    const e: Errors<Field> = {
      name: v.required(t, form.name) ?? v.maxLen(t, form.name, 120),
      phone: v.phone(t, form.phone),
      email: form.email.trim() ? v.email(t, form.email) : null,
    };
    setErrors(e);
    if (hasErrors(e)) return;
    setPending(true);
    const row = Object.fromEntries(Object.entries(form).map(([k, val]) => [k, val.trim()])) as Record<Field, string>;
    const { error } = editing ? await supabase.from('suppliers').update(row).eq('id', editing.id) : await supabase.from('suppliers').insert(row);
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('common.saved'));
    onSaved();
  };

  return (
    <Modal
      open={supplier !== null}
      onClose={onClose}
      title={editing ? t('suppliers.edit') : t('suppliers.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput className="sm:col-span-2" label={t('common.name')} value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} required data-autofocus />
        <TextInput label={t('suppliers.contact')} value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
        <TextInput label={t('common.phone')} type="tel" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        <TextInput className="sm:col-span-2" label={t('common.email')} type="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
        <TextInput className="sm:col-span-2" label={t('common.address')} value={form.address} onChange={(e) => set('address', e.target.value)} />
        <Textarea className="sm:col-span-2" label={t('common.notes')} value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
      </div>
    </Modal>
  );
}

export function SuppliersTab({ suppliers, ingredients }: { suppliers: QueryState<Supplier[]>; ingredients: Ingredient[] }) {
  const t = useT();
  const { f } = useSettings();
  const supSel = useSelection((suppliers.data ?? []).map((x) => x.id));
  const removeMany = useDeleteMany();
  const bulkDelete = () =>
    void removeMany('supplier', [...supSel.ids]).then((ok) => {
      if (!ok) return;
      supSel.clear();
      void suppliers.refetch();
    });
  const removeRecord = useDeleteRecord();
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null);

  const remove = async (s: Supplier) => {
    if (await removeRecord('supplier', s.id, s.name)) void suppliers.refetch();
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" onClick={() => setEdit('new')}>{t('suppliers.add')}</Button>
      </div>
      {suppliers.loading && !suppliers.data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-card" />)}</div>
      ) : (suppliers.data ?? []).length === 0 ? (
        <EmptyState icon={<Truck className="size-7" />} title={t('suppliers.empty')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(suppliers.data ?? []).map((s) => {
            const count = ingredients.filter((i) => i.supplier_id === s.id).length;
            return (
              <Card key={s.id} className={cn('relative p-5', supSel.has(s.id) && 'border-brand/60 bg-brand/[0.06]')}>
                <SelectBox className="absolute end-3 bottom-3" checked={supSel.has(s.id)} onChange={(on) => supSel.toggle(s.id, on)} label={`${t('bulk.selectRow')} ${s.name}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-btn border border-line bg-elevated text-fg-3"><Truck className="size-[1.125rem]" strokeWidth={1.5} /></span>
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-fg-3">{s.contact_name || t('common.none')}</p>
                    </div>
                  </div>
                  <Badge tone="neutral">{t('suppliers.materials', { count: f.number(count) })}</Badge>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm text-fg-2">
                  {s.phone && <li className="flex items-center gap-2"><Phone className="size-4 text-fg-3" /><a href={`tel:${s.phone}`} dir="ltr" className="hover:text-fg">{s.phone}</a></li>}
                  {s.email && <li className="flex items-center gap-2"><Mail className="size-4 text-fg-3" /><a href={`mailto:${s.email}`} dir="ltr" className="truncate hover:text-fg">{s.email}</a></li>}
                  {s.address && <li className="flex items-center gap-2"><MapPin className="size-4 text-fg-3" />{s.address}</li>}
                </ul>
                {s.notes && <p className="mt-3 rounded-btn bg-fg/[0.03] p-2 text-xs text-fg-3">{s.notes}</p>}
                <div className="mt-4 flex justify-end gap-1 border-t border-line pt-3">
                  <IconButton label={t('common.edit')} size="sm" onClick={() => setEdit(s)}><Pencil className="size-4" /></IconButton>
                  <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(s)}><Trash className="size-4" /></IconButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <BulkBar selection={supSel} onDelete={bulkDelete} />
      <SupplierModal supplier={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void suppliers.refetch(); }} />
    </>
  );
}
