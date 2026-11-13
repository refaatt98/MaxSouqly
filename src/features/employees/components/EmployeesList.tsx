import { useEffect, useState } from 'react';
import { KeyRound, LogIn, LogOut, Pencil, Trash, UserPlus, Users } from 'lucide-react';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { toISODate } from '@/lib/dates';
import { hasErrors, v, type Errors } from '@/lib/validation';
import { useQuery, type QueryState } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useAuth } from '@/app/providers/AuthProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useDeleteRecord, useDeleteMany } from '@/app/providers/DeleteProvider';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column, BulkBar, useSelection } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ImageUploader, useImageField } from '@/components/ui/ImageUploader';
import { ROLES, type AppRole } from '@/types/models';
import { createEmployeeUser, fetchOpenAttendance, type EmployeeRow } from '../api';
import { NewUserModal } from './StaffTabs';

type Field = 'full_name' | 'position' | 'phone' | 'salary_type' | 'salary_amount' | 'hire_date';

function EmployeeModal({ employee, onClose, onSaved }: { employee: EmployeeRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const editing = employee !== null && employee !== 'new' ? employee : null;
  const avatar = useImageField(editing?.avatar_url ?? null);
  const [form, setForm] = useState<Record<Field, string>>({ full_name: '', position: '', phone: '', salary_type: 'daily', salary_amount: '0', hire_date: toISODate(new Date()) });
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Errors<Field>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (employee === null) return;
    setForm({
      full_name: editing?.full_name ?? '',
      position: editing?.position ?? '',
      phone: editing?.phone ?? '',
      salary_type: editing?.salary_type ?? 'daily',
      salary_amount: String(editing?.salary_amount ?? 0),
      hire_date: editing?.hire_date ?? toISODate(new Date()),
    });
    setActive(editing?.is_active ?? true);
    setErrors({});
    avatar.reset(editing?.avatar_url ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  const set = (k: Field, value: string) => setForm((s) => ({ ...s, [k]: value }));
  const save = async () => {
    const e: Errors<Field> = {
      full_name: v.minLen(t, form.full_name, 2) ?? v.maxLen(t, form.full_name, 120),
      phone: v.phone(t, form.phone),
      salary_amount: v.number(t, form.salary_amount, { min: 0, max: 1_000_000 }),
      hire_date: v.required(t, form.hire_date),
    };
    setErrors(e);
    if (hasErrors(e)) return;
    setPending(true);
    const row = {
      full_name: form.full_name.trim(),
      position: form.position.trim(),
      phone: form.phone.trim(),
      salary_type: form.salary_type as 'monthly' | 'hourly' | 'daily',
      salary_amount: Number(form.salary_amount),
      hire_date: form.hire_date,
      is_active: active,
      avatar_url: avatar.url,
    };
    const { error } = editing ? await supabase.from('employees_meta').update(row).eq('id', editing.id) : await supabase.from('employees_meta').insert(row);
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    await avatar.commit();
    toast.success(t('common.saved'));
    onSaved();
  };
  const cancel = () => {
    void avatar.discard();
    onClose();
  };

  return (
    <Modal
      open={employee !== null}
      onClose={cancel}
      size="lg"
      title={editing ? t('employees.edit') : t('employees.new')}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <ImageUploader className="md:col-span-2" value={avatar.url} onChange={avatar.setUrl} folder="avatars" shape="circle" label={t('settings.avatar')} />
        <TextInput label={t('common.name')} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} required data-autofocus />
        <TextInput label={t('employees.position')} value={form.position} onChange={(e) => set('position', e.target.value)} />
        <TextInput label={t('common.phone')} type="tel" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        <TextInput label={t('employees.hireDate')} type="date" value={form.hire_date} onChange={(e) => set('hire_date', e.target.value)} error={errors.hire_date} />
        <Select
          label={t('employees.salaryType')}
          value={form.salary_type}
          onChange={(e) => set('salary_type', e.target.value)}
          options={[
            { value: 'daily', label: t('employees.salary.daily') },
            { value: 'hourly', label: t('employees.salary.hourly') },
            // older records only: the system pays by the day or by the hour
            ...(form.salary_type === 'monthly' ? [{ value: 'monthly', label: t('employees.salary.monthly') }] : []),
          ]}
        />
        <TextInput
          label={form.salary_type === 'hourly' ? t('employees.hourlyRate') : form.salary_type === 'daily' ? t('employees.dailyRate') : t('employees.salaryAmount')}
          type="number"
          inputMode="decimal"
          min={0}
          value={form.salary_amount}
          onChange={(e) => set('salary_amount', e.target.value)}
          error={errors.salary_amount}
          suffix="₪"
        />
        <Toggle id="emp-active" label={t('common.active')} checked={active} onChange={setActive} />
      </div>
    </Modal>
  );
}

function AccountModal({ employee, onClose, onSaved }: { employee: EmployeeRow | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('cashier');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; pin?: string | null }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setEmail('');
    setPassword('');
    setRole('cashier');
    setPin('');
    setErrors({});
  }, [employee]);

  const save = async () => {
    if (!employee) return;
    const e = {
      email: v.email(t, email),
      password: password.length < 8 ? t('errors.WEAK_PASSWORD') : null,
      pin: pin && !/^\d{4,6}$/.test(pin) ? t('errors.INVALID_PIN') : null,
    };
    setErrors(e);
    if (e.email || e.password || e.pin) return;
    setPending(true);
    try {
      await createEmployeeUser({ email: email.trim(), password, full_name: employee.full_name, role, phone: employee.phone, pin: pin || undefined, employee_id: employee.id });
      toast.success(t('employees.accountCreated'));
      onSaved();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={employee !== null}
      onClose={onClose}
      title={employee ? t('employees.createAccountTitle', { name: employee.full_name }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.create')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextInput label={t('common.email')} type="email" dir="ltr" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required data-autofocus />
        <TextInput label={t('employees.password')} type="text" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />
        <Select label={t('employees.role')} value={role} onChange={(e) => setRole(e.target.value as AppRole)} options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
        <TextInput label={t('employees.pinOptional')} inputMode="numeric" dir="ltr" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} error={errors.pin} />
      </div>
    </Modal>
  );
}

export function PinModal({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setPin('');
    setError(null);
  }, [target]);

  const save = async (value: string | null) => {
    if (!target) return;
    if (value !== null && !/^\d{4,6}$/.test(value)) {
      setError(t('errors.INVALID_PIN'));
      return;
    }
    setPending(true);
    const { error: e } = await supabase.rpc('set_pin', { p_user_id: target.id, p_pin: value as string });
    setPending(false);
    if (e) return setError(errorMessage(t, e));
    toast.success(t('employees.pinSaved'));
    onClose();
  };

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      size="sm"
      title={target ? t('employees.pinTitle', { name: target.name }) : ''}
      footer={
        <>
          <Button variant="danger" className="me-auto" onClick={() => void save(null)} disabled={pending}>{t('employees.removePin')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save(pin)}>{t('common.save')}</Button>
        </>
      }
    >
      <TextInput
        label={t('employees.newPin')}
        inputMode="numeric"
        dir="ltr"
        maxLength={6}
        inputSize="lg"
        className="text-center"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, ''));
          setError(null);
        }}
        error={error}
        data-autofocus
      />
    </Modal>
  );
}

export function EmployeesList({ employees }: { employees: QueryState<EmployeeRow[]> }) {
  const t = useT();
  const { f } = useSettings();
  const { role, profile } = useAuth();
  const toast = useToast();
  const removeRecord = useDeleteRecord();
  const openAtt = useQuery(fetchOpenAttendance, []);
  useLiveRefetch(['attendance'], openAtt.refetch);
  const [edit, setEdit] = useState<EmployeeRow | 'new' | null>(null);
  const [account, setAccount] = useState<EmployeeRow | null>(null);
  const [pinTarget, setPinTarget] = useState<{ id: string; name: string } | null>(null);
  const [newUser, setNewUser] = useState(false);
  const onClock = new Set((openAtt.data ?? []).map((a) => a.employee_id));

  const clock = async (e: EmployeeRow, action: 'in' | 'out') => {
    const { error } = action === 'in' ? await supabase.rpc('clock_in', { p_employee_id: e.id }) : await supabase.rpc('clock_out', { p_employee_id: e.id });
    if (error) return toast.error(errorMessage(t, error));
    toast.success(action === 'in' ? t('employees.clockedIn') : t('employees.clockedOut'));
    void openAtt.refetch();
  };

  const remove = async (e: EmployeeRow) => {
    if (await removeRecord('employee', e.id, e.full_name)) void employees.refetch();
  };

  const columns: Column<EmployeeRow>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar name={e.full_name} url={e.avatar_url ?? e.profile?.avatar_url} />
          <div>
            <p className="text-fg">{e.full_name}</p>
            <p className="text-xs text-fg-3" dir="ltr">{e.phone}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'position',
      header: t('employees.position'),
      cell: (e) => (
        <div>
          <p>{e.position || t('common.none')}</p>
          <p className="text-xs text-fg-3">{e.profile ? t(`role.${e.profile.role}`) : t('employees.noAccount')}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (e) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={e.is_active ? 'green' : 'neutral'} dot>{e.is_active ? t('common.active') : t('common.inactive')}</Badge>
          {onClock.has(e.id) && <Badge tone="blue">{t('employees.onClock')}</Badge>}
        </div>
      ),
    },
    {
      key: 'last',
      header: t('employees.lastLogin'),
      hideBelow: 'md',
      cell: (e) => <span className="num text-fg-2">{e.profile?.last_login_at ? f.dateTime(e.profile.last_login_at) : t('employees.never')}</span>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'end',
      cell: (e) => (
        <div className="flex justify-end">
          {onClock.has(e.id) ? (
            <IconButton label={t('employees.clockOut')} size="sm" onClick={() => void clock(e, 'out')} className="text-fg-2"><LogOut className="size-4 rtl:-scale-x-100" /></IconButton>
          ) : (
            <IconButton label={t('employees.clockIn')} size="sm" onClick={() => void clock(e, 'in')} disabled={!e.is_active}><LogIn className="size-4 rtl:-scale-x-100" /></IconButton>
          )}
          {e.profile ? (
            <IconButton label={t('employees.setPin')} size="sm" onClick={() => setPinTarget({ id: e.profile!.id, name: e.full_name })}><KeyRound className="size-4" /></IconButton>
          ) : (
            role === 'owner' && <IconButton label={t('employees.createAccount')} size="sm" onClick={() => setAccount(e)}><UserPlus className="size-4" /></IconButton>
          )}
          <IconButton label={t('common.edit')} size="sm" onClick={() => setEdit(e)}><Pencil className="size-4" /></IconButton>
          {e.profile?.id !== profile?.id && <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(e)}><Trash className="size-4" /></IconButton>}
        </div>
      ),
    },
  ];

  const sel1 = useSelection((employees.data ?? []).map((x) => x.id));
  const removeMany1 = useDeleteMany();
  const bulkDelete1 = () =>
    void removeMany1('employee', [...sel1.ids]).then((ok) => {
      if (ok) {
        sel1.clear();
        void employees.refetch();
      }
    });

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        {role === 'owner' && <Button onClick={() => setNewUser(true)}>{t('employees.addUser')}</Button>}
        <Button variant="primary" onClick={() => setEdit('new')}>{t('employees.add')}</Button>
      </div>
      <Card className="overflow-hidden">
        {employees.error && !employees.data ? (
          <ErrorState message={errorMessage(t, employees.error)} onRetry={() => void employees.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <DataTable selection={(role === 'owner' || role === 'manager') ? sel1 : undefined} canSelect={(e) => e.profile?.id !== profile?.id}
            columns={columns}
            rows={employees.data ?? []}
            rowKey={(e) => e.id}
            loading={employees.loading && !employees.data}
            rowClassName={(e) => (e.is_active ? undefined : 'opacity-55')}
            empty={<EmptyState icon={<Users className="size-7" />} title={t('employees.empty')} />}
          />
        )}
      </Card>
      {(role === 'owner' || role === 'manager') && <BulkBar selection={sel1} onDelete={bulkDelete1} />}
      <EmployeeModal employee={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void employees.refetch(); }} />
      <AccountModal employee={account} onClose={() => setAccount(null)} onSaved={() => { setAccount(null); void employees.refetch(); }} />
      <PinModal target={pinTarget} onClose={() => setPinTarget(null)} />
      <NewUserModal open={newUser} onClose={() => setNewUser(false)} onCreated={() => { setNewUser(false); void employees.refetch(); }} />
    </>
  );
}
