import { useEffect, useState } from 'react';
import { Info, Pencil, Plus, Printer as PrinterIcon, Trash } from 'lucide-react';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { printHtml } from '@/lib/print';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { EmptyState } from '@/components/ui/EmptyState';
import { BulkBar, SelectBox, useSelection } from '@/components/ui/Table';
import { cn } from '@/lib/cn';
import type { Printer } from '@/types/models';

type Form = { name: string; kind: 'kitchen' | 'receipt'; connection: 'wifi' | 'bluetooth' | 'usb'; address: string; paper_width: '80' | '58'; is_active: boolean };
const EMPTY: Form = { name: '', kind: 'kitchen', connection: 'wifi', address: '', paper_width: '80', is_active: true };

/**
 * Printers of the restaurant. Kitchen printers are stations: each category (or single item) is sent to one,
 * and every order prints one ticket per station plus the full customer receipt.
 */
export function PrintersTab() {
  const { t, lang } = useI18n();
  const { settings, update } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const list = useQuery(async (): Promise<Printer[]> => {
    const { data, error } = await supabase.from('printers').select('*').order('sort_order').order('name');
    if (error) throw error;
    return data;
  }, []);
  useLiveRefetch(['printers'], list.refetch);
  const [edit, setEdit] = useState<Printer | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (edit === null) return;
    setForm(
      edit === 'new'
        ? EMPTY
        : { name: edit.name, kind: edit.kind as Form['kind'], connection: edit.connection as Form['connection'], address: edit.address, paper_width: String(edit.paper_width) as Form['paper_width'], is_active: edit.is_active },
    );
  }, [edit]);

  const save = async () => {
    if (!form.name.trim()) return toast.error(t('common.required'));
    setPending(true);
    const row = { name: form.name.trim(), kind: form.kind, connection: form.connection, address: form.address.trim(), paper_width: Number(form.paper_width), is_active: form.is_active };
    const { error } = edit && edit !== 'new' ? await supabase.from('printers').update(row).eq('id', edit.id) : await supabase.from('printers').insert({ ...row, sort_order: (list.data?.length ?? 0) + 1 });
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('common.saved'));
    setEdit(null);
    void list.refetch();
  };

  const remove = async (p: Printer) => {
    if (!(await confirm({ title: t('printers.deleteTitle', { name: p.name }), body: t('printers.deleteBody'), danger: true }))) return;
    const { error } = await supabase.from('printers').delete().eq('id', p.id);
    if (error) return toast.error(errorMessage(t, error));
    void list.refetch();
  };

  const prSel = useSelection((list.data ?? []).map((p) => p.id));
  const bulkDelete = async () => {
    if (!(await confirm({ title: t('printers.deleteMany', { count: prSel.count }), body: t('printers.deleteBody'), danger: true }))) return;
    const { error } = await supabase.from('printers').delete().in('id', [...prSel.ids]);
    if (error) return toast.error(errorMessage(t, error));
    prSel.clear();
    void list.refetch();
  };

  const testPrint = (p: Printer) =>
    void printHtml(
      `<div style="text-align:center;font-size:22px;font-weight:800">MAX</div><hr><div style="text-align:center;font-size:18px">${p.name}</div><div style="text-align:center">${t('printers.testLine')}</div><div style="text-align:center">${new Date().toLocaleString()}</div>`,
      `@page { size: ${p.paper_width}mm auto; margin: 0; } body { margin: 0; padding: 4mm; width: ${p.paper_width}mm; font-family: sans-serif; }`,
      lang,
    );

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-3 p-4 text-sm text-fg-2">
        <Info className="mt-0.5 size-4 shrink-0 text-fg-3" />
        <p>{t('printers.howItWorks')}</p>
      </Card>
      <Card className="p-4">
        <Toggle
          id="s-print-send"
          label={t('printers.printOnSend')}
          description={t('printers.printOnSendHint')}
          checked={settings?.print_kitchen_on_send ?? true}
          onChange={(v) => void update({ print_kitchen_on_send: v }).catch((e: unknown) => toast.error(errorMessage(t, e)))}
        />
      </Card>
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>{t('printers.add')}</Button>
      </div>
      {(list.data ?? []).length === 0 && !list.loading ? (
        <Card>
          <EmptyState icon={<PrinterIcon className="size-6" />} title={t('printers.empty')} body={t('printers.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(list.data ?? []).map((p) => (
            <Card key={p.id} className={cn('flex items-center gap-3 p-4', prSel.has(p.id) && 'border-brand/60 bg-brand/[0.06]')}>
              <SelectBox checked={prSel.has(p.id)} onChange={(on) => prSel.toggle(p.id, on)} label={`${t('bulk.selectRow')} ${p.name}`} />
              <PrinterIcon className="size-6 shrink-0 text-fg-3" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-fg">
                  {p.name} {!p.is_active && <Badge>{t('common.inactive')}</Badge>}
                </p>
                <p className="text-xs text-fg-3">
                  {t(`printers.kind.${p.kind as Form['kind']}`)} · {t(`printers.conn.${p.connection as Form['connection']}`)} · {p.paper_width}mm
                  {p.address && <span dir="ltr"> · {p.address}</span>}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => testPrint(p)}>{t('printers.test')}</Button>
              <IconButton label={t('common.edit')} size="sm" onClick={() => setEdit(p)}><Pencil className="size-4" /></IconButton>
              <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(p)}><Trash className="size-4" /></IconButton>
            </Card>
          ))}
        </div>
      )}
      <BulkBar selection={prSel} onDelete={() => void bulkDelete()} />
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        size="sm"
        title={edit === 'new' ? t('printers.add') : t('printers.edit')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <TextInput label={t('common.name')} placeholder={t('printers.namePlaceholder')} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select
            label={t('printers.type')}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as Form['kind'] })}
            options={[{ value: 'kitchen', label: t('printers.kind.kitchen') }, { value: 'receipt', label: t('printers.kind.receipt') }]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('printers.connection')}
              value={form.connection}
              onChange={(e) => setForm({ ...form, connection: e.target.value as Form['connection'] })}
              options={(['wifi', 'bluetooth', 'usb'] as const).map((c) => ({ value: c, label: t(`printers.conn.${c}`) }))}
            />
            <Select
              label={t('printers.paper')}
              value={form.paper_width}
              onChange={(e) => setForm({ ...form, paper_width: e.target.value as Form['paper_width'] })}
              options={[{ value: '80', label: '80mm' }, { value: '58', label: '58mm' }]}
            />
          </div>
          <TextInput label={t('printers.address')} hint={t('printers.addressHint')} dir="ltr" value={form.address} maxLength={120} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Toggle id="pr-active" label={t('common.active')} checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
        </div>
      </Modal>
    </div>
  );
}
