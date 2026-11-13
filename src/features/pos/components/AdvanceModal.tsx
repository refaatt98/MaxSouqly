import { useEffect, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Input';
import { fetchStaffBoard, recordAdvance, type StaffMember } from '../api';

/** Cash advance paid from the drawer; deducted from the employee's next payroll. */
export function AdvanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [employee, setEmployee] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployee('');
    setAmount('');
    setNote('');
    fetchStaffBoard().then(setStaff, (e) => toast.error(errorMessage(t, e)));
  }, [open, t, toast]);

  const n = Number(amount);
  const valid = employee !== '' && Number.isFinite(n) && n > 0;

  const save = async () => {
    if (!valid) return;
    setPending(true);
    try {
      await recordAdvance(employee, n, note.trim());
      toast.success(t('advance.saved', { name: staff.find((s) => s.id === employee)?.full_name ?? '', amount: f.money(n) }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('advance.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={<HandCoins className="size-4" />} disabled={!valid} loading={pending} onClick={() => void save()}>
            {t('advance.record')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-3">{t('advance.hint')}</p>
        <Select
          label={t('employees.shiftEmployee')}
          value={employee}
          placeholder="—"
          onChange={(e) => setEmployee(e.target.value)}
          options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
        />
        <TextInput label={t('common.amount')} type="number" inputMode="decimal" min={0} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="₪" />
        <TextInput label={t('common.notes')} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
