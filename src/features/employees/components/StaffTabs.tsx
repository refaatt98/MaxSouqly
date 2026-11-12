import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, HandCoins, KeyRound, LogIn, LogOut, ShieldCheck, Trash, UserPlus, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { addDays, rangeToTimestamps, startOfMonth, startOfWeek, toISODate } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useAuth, PROFILE_COLUMNS } from '@/app/providers/AuthProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ROLES, type AppRole, type Attendance, type Payroll, type Profile } from '@/types/models';
import { createEmployeeUser, hoursBetween, resetUserPassword, type EmployeeRow } from '../api';

// ===================================================================== shifts
export function ShiftsTab({ employees }: { employees: EmployeeRow[] }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = toISODate(days[0]);
  const to = toISODate(days[6]);
  const shifts = useQuery(async () => {
    const { data, error } = await supabase.from('work_shifts').select('*').gte('shift_date', from).lte('shift_date', to).order('start_time');
    if (error) throw error;
    return data;
  }, [from, to]);
  useLiveRefetch(['work_shifts'], shifts.refetch);
  const [draft, setDraft] = useState<{ employee_id: string; date: string; start: string; end: string; notes: string; id?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const active = employees.filter((e) => e.is_active);

  const save = async () => {
    if (!draft) return;
    if (!draft.employee_id || !draft.start || !draft.end) return;
    setPending(true);
    const row = { employee_id: draft.employee_id, shift_date: draft.date, start_time: draft.start, end_time: draft.end, notes: draft.notes.trim() };
    const { error } = draft.id ? await supabase.from('work_shifts').update(row).eq('id', draft.id) : await supabase.from('work_shifts').insert(row);
    setPending(false);
    if (error) return toast.error(errorMessage(t, error));
    setDraft(null);
    void shifts.refetch();
  };
  const remove = async () => {
    if (!draft?.id) return;
    const { error } = await supabase.from('work_shifts').delete().eq('id', draft.id);
    if (error) return toast.error(errorMessage(t, error));
    setDraft(null);
    void shifts.refetch();
  };

  const cell = (empId: string, date: string) => (shifts.data ?? []).filter((s) => s.employee_id === empId && s.shift_date === date);
  const today = toISODate(new Date());

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label={t('employees.prevWeek')} onClick={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft className="size-5 rtl:-scale-x-100" /></IconButton>
          <Button variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>{t('employees.thisWeek')}</Button>
          <IconButton label={t('employees.nextWeek')} onClick={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight className="size-5 rtl:-scale-x-100" /></IconButton>
          <span className="num ms-2 text-sm font-semibold text-fg-2">{f.shortDate(days[0])} — {f.shortDate(days[6])}</span>
        </div>
        <Button variant="primary" onClick={() => setDraft({ employee_id: active[0]?.id ?? '', date: today >= from && today <= to ? today : from, start: '10:00', end: '18:00', notes: '' })}>
          {t('employees.addShift')}
        </Button>
      </div>
      <Card className="overflow-x-auto">
        {shifts.loading && !shifts.data ? (
          <SkeletonRows rows={6} />
        ) : (
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky start-0 z-[1] border-b border-line bg-card px-3 py-3 text-start text-xs text-fg-3">{t('employees.shiftEmployee')}</th>
                {days.map((d, i) => (
                  <th key={i} className={cn('border-b border-line px-2 py-3 text-xs', toISODate(d) === today ? 'text-fg' : 'text-fg-3')}>
                    {t(`day.${i}` as 'day.0')}
                    <span className="num block font-normal">{f.shortDate(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((e) => (
                <tr key={e.id}>
                  <th scope="row" className="sticky start-0 z-[1] border-b border-line bg-card px-3 py-2 text-start font-semibold whitespace-nowrap">
                    <span className="flex items-center gap-2"><Avatar name={e.full_name} url={e.avatar_url} size="sm" />{e.full_name}</span>
                  </th>
                  {days.map((d) => {
                    const date = toISODate(d);
                    const list = cell(e.id, date);
                    return (
                      <td key={date} className={cn('h-16 border-b border-s border-line p-1 align-top', date === today && 'bg-white/[0.02]')}>
                        <div className="flex h-full flex-col gap-1">
                          {list.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setDraft({ id: s.id, employee_id: s.employee_id, date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), notes: s.notes })}
                              className={cn('num rounded-btn px-2 py-1 text-[11px] font-semibold', Number(s.start_time.slice(0, 2)) < 14 ? 'bg-elevated text-fg' : 'bg-elevated text-fg-2')}
                              dir="ltr"
                            >
                              {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                            </button>
                          ))}
                          {list.length === 0 && (
                            <button
                              type="button"
                              aria-label={t('employees.addShift')}
                              onClick={() => setDraft({ employee_id: e.id, date, start: '10:00', end: '18:00', notes: '' })}
                              className="h-full min-h-10 w-full rounded-btn text-lg text-transparent transition-colors hover:bg-white/5 hover:text-fg-3"
                            >
                              +
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        size="sm"
        title={t('employees.shiftTitle')}
        footer={
          <>
            {draft?.id && <Button variant="danger" className="me-auto" icon={<Trash className="size-4" />} onClick={() => void remove()}>{t('common.delete')}</Button>}
            <Button variant="ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
          </>
        }
      >
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select className="sm:col-span-2" label={t('employees.shiftEmployee')} value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })} options={active.map((e) => ({ value: e.id, label: e.full_name }))} />
            <TextInput className="sm:col-span-2" label={t('common.date')} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <TextInput label={t('employees.start')} type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            <TextInput label={t('employees.end')} type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            <Textarea className="sm:col-span-2" label={t('common.notes')} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} />
          </div>
        )}
      </Modal>
    </>
  );
}

// ============================================================ account modals
export function NewUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'cashier' as AppRole, phone: '', pin: '' });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ full_name: '', email: '', password: '', role: 'cashier', phone: '', pin: '' });
      setErrors({});
    }
  }, [open]);
  const set = (k: keyof typeof form, val: string) => setForm((f) => ({ ...f, [k]: val }));

  const save = async () => {
    const e = {
      full_name: form.full_name.trim().length < 2 ? t('validation.minLength', { min: 2 }) : null,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? null : t('errors.INVALID_EMAIL'),
      password: form.password.length < 8 ? t('errors.WEAK_PASSWORD') : null,
      phone: form.phone && !/^[0-9+\- ]{7,20}$/.test(form.phone.trim()) ? t('validation.phone') : null,
      pin: form.pin && !/^\d{4,6}$/.test(form.pin) ? t('errors.INVALID_PIN') : null,
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setPending(true);
    try {
      await createEmployeeUser({ ...form, pin: form.pin || undefined });
      toast.success(t('employees.accountCreated'));
      onCreated();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('employees.newUser')}
      description={t('employees.newUserHint')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.create')}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label={t('common.name')} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} required data-autofocus />
        <Select label={t('employees.role')} value={form.role} onChange={(e) => set('role', e.target.value)} options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
        <TextInput label={t('common.email')} type="email" dir="ltr" autoComplete="off" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} required />
        <TextInput label={t('employees.password')} type="text" dir="ltr" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} error={errors.password} required />
        <TextInput label={t('common.phone')} type="tel" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        <TextInput label={t('employees.pinOptional')} inputMode="numeric" dir="ltr" maxLength={6} value={form.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} error={errors.pin} />
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: Profile | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setPassword('');
    setError(null);
  }, [user]);
  const save = async () => {
    if (!user) return;
    if (password.length < 8) return setError(t('errors.WEAK_PASSWORD'));
    setPending(true);
    try {
      await resetUserPassword(user.id, password);
      toast.success(t('employees.passwordReset'));
      onClose();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      size="sm"
      title={user ? t('employees.resetPasswordTitle', { name: user.full_name }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <TextInput label={t('settings.newPassword')} type="text" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} error={error} data-autofocus />
    </Modal>
  );
}

// ================================================================ permissions
export function PermissionsTab() {
  const t = useT();
  const { f } = useSettings();
  const { role, profile } = useAuth();
  const toast = useToast();
  const users = useQuery(async () => {
    const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).order('full_name');
    if (error) throw error;
    return data as Profile[];
  }, []);
  const isOwner = role === 'owner';
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Profile | null>(null);

  const update = async (u: Profile, next: { role?: AppRole; is_active?: boolean }) => {
    const { data, error } = await supabase.rpc('admin_update_profile', { p_user_id: u.id, p_role: next.role ?? u.role, p_is_active: next.is_active ?? u.is_active });
    if (error) return toast.error(errorMessage(t, error));
    users.setData((list = []) => list.map((x) => (x.id === u.id ? { ...x, role: data.role, is_active: data.is_active } : x)));
    toast.success(t('common.saved'));
  };

  const columns: Column<Profile>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.full_name} url={u.avatar_url} size="sm" />
          <span className="font-semibold">{u.full_name}</span>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('employees.role'),
      cell: (u) =>
        isOwner && u.id !== profile?.id ? (
          <select
            value={u.role}
            onChange={(e) => void update(u, { role: e.target.value as AppRole })}
            aria-label={t('employees.role')}
            className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-sm focus:border-fg-3 focus:outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`role.${r}`)}</option>
            ))}
          </select>
        ) : (
          <Badge tone={u.role === 'owner' ? 'gold' : 'neutral'}>{t(`role.${u.role}`)}</Badge>
        ),
    },
    { key: 'last', header: t('employees.lastLogin'), hideBelow: 'md', cell: (u) => <span className="num text-fg-2">{u.last_login_at ? f.dateTime(u.last_login_at) : t('employees.never')}</span> },
    {
      key: 'active',
      header: t('employees.accountActive'),
      align: 'end',
      cell: (u) => <Toggle checked={u.is_active} disabled={!isOwner || u.id === profile?.id} onChange={(v) => void update(u, { is_active: v })} />,
    },
    ...(isOwner
      ? [
          {
            key: 'pw',
            header: '',
            align: 'end' as const,
            cell: (u: Profile) => (
              <IconButton label={t('employees.resetPassword')} size="sm" onClick={() => setResetting(u)}>
                <KeyRound className="size-4" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Card className="mb-4 flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-fg" />
        <div className="text-sm">
          <p className="text-fg-2">{t('employees.permissionsHint')}</p>
          {!isOwner && <p className="mt-1 font-semibold text-warning">{t('employees.ownerOnly')}</p>}
        </div>
        {isOwner && (
          <Button variant="primary" className="ms-auto shrink-0" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
            {t('employees.addUser')}
          </Button>
        )}
      </Card>
      <Card className="overflow-hidden">
        <DataTable columns={columns} rows={users.data ?? []} rowKey={(u) => u.id} loading={users.loading && !users.data} empty={null} />
      </Card>
      <NewUserModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void users.refetch(); }} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

// ================================================================= attendance
export function AttendanceTab({ employees }: { employees: EmployeeRow[] }) {
  const t = useT();
  const { f } = useSettings();
  const { profile, role } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [from, setFrom] = useState(() => toISODate(addDays(new Date(), -6)));
  const [to, setTo] = useState(() => toISODate(new Date()));
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const me = employees.find((e) => e.profile?.id === profile?.id);
  const rows = useQuery(async () => {
    const { start, end } = rangeToTimestamps(from, to);
    const { data, error } = await supabase.from('attendance').select('*').gte('clock_in', start).lt('clock_in', end).order('clock_in', { ascending: false });
    if (error) throw error;
    return data;
  }, [from, to]);
  useLiveRefetch(['attendance'], rows.refetch);
  const myOpen = (rows.data ?? []).find((a) => a.employee_id === me?.id && !a.clock_out);

  const clock = async (action: 'in' | 'out') => {
    const { error } = action === 'in' ? await supabase.rpc('clock_in', {}) : await supabase.rpc('clock_out', {});
    if (error) return toast.error(errorMessage(t, error));
    toast.success(action === 'in' ? t('employees.clockedIn') : t('employees.clockedOut'));
    void rows.refetch();
  };
  const remove = async (a: Attendance) => {
    if (!(await confirm({ title: t('common.delete'), danger: true }))) return;
    const { error } = await supabase.from('attendance').delete().eq('id', a.id);
    if (error) return toast.error(errorMessage(t, error));
    void rows.refetch();
  };

  const totalHours = (rows.data ?? []).reduce((s, a) => s + hoursBetween(a.clock_in, a.clock_out), 0);
  const columns: Column<Attendance>[] = [
    { key: 'emp', header: t('employees.shiftEmployee'), cell: (a) => <span className="font-semibold">{names.get(a.employee_id)?.full_name ?? t('common.unknown')}</span> },
    { key: 'in', header: t('employees.clockInAt'), cell: (a) => <span className="num">{f.dateTime(a.clock_in)}</span> },
    { key: 'out', header: t('employees.clockOutAt'), cell: (a) => (a.clock_out ? <span className="num">{f.time(a.clock_out)}</span> : <Badge tone="blue">{t('employees.stillOnClock')}</Badge>) },
    { key: 'dur', header: t('employees.duration'), align: 'end', cell: (a) => <span className="num font-semibold">{f.number(hoursBetween(a.clock_in, a.clock_out), 1)} {t('common.hoursShort')}</span> },
    ...(role === 'owner' || role === 'manager'
      ? [{ key: 'x', header: '', align: 'end' as const, cell: (a: Attendance) => <IconButton label={t('common.delete')} size="sm" className="hover:text-danger" onClick={() => void remove(a)}><Trash className="size-4" /></IconButton> }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {me && (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <Clock className="size-8 text-fg-2" />
          <div className="flex-1">
            <p className="font-semibold">{t('employees.myClock')}</p>
            <p className="text-sm text-fg-3">{myOpen ? `${t('employees.onClock')} · ${f.time(myOpen.clock_in)}` : me.full_name}</p>
          </div>
          {myOpen ? (
            <Button variant="secondary" icon={<LogOut className="size-4 rtl:-scale-x-100" />} onClick={() => void clock('out')}>{t('employees.clockOut')}</Button>
          ) : (
            <Button variant="primary" icon={<LogIn className="size-4 rtl:-scale-x-100" />} onClick={() => void clock('in')}>{t('employees.clockIn')}</Button>
          )}
        </Card>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <TextInput type="date" label={t('common.from')} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <TextInput type="date" label={t('common.to')} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <span className="num ms-auto pb-3 text-sm text-fg-2">{t('employees.hours')}: <b className="text-fg">{f.number(totalHours, 1)}</b></span>
        <Button
          className="mb-0.5"
          onClick={() =>
            downloadCsv(
              `max-attendance-${from}_${to}`,
              [t('employees.shiftEmployee'), t('employees.clockInAt'), t('employees.clockOutAt'), t('employees.hours')],
              (rows.data ?? []).map((a) => [names.get(a.employee_id)?.full_name ?? '', new Date(a.clock_in).toLocaleString('en-GB'), a.clock_out ? new Date(a.clock_out).toLocaleString('en-GB') : '', hoursBetween(a.clock_in, a.clock_out).toFixed(2)]),
            )
          }
        >
          {t('common.export')}
        </Button>
      </div>
      <Card className="overflow-hidden">
        <DataTable columns={columns} rows={rows.data ?? []} rowKey={(a) => a.id} loading={rows.loading && !rows.data} empty={<EmptyState icon={<CalendarDays className="size-7" />} title={t('employees.attendanceEmpty')} />} />
      </Card>
    </div>
  );
}

// ==================================================================== payroll
export function PayrollTab({ employees }: { employees: EmployeeRow[] }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(() => toISODate(startOfMonth(new Date())).slice(0, 7));
  const period = `${month}-01`;
  const rows = useQuery(async () => {
    const { data, error } = await supabase.from('payroll').select('*').eq('period_month', period);
    if (error) throw error;
    return data;
  }, [period]);
  useLiveRefetch(['payroll'], rows.refetch);
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const [computing, setComputing] = useState(false);
  const [edit, setEdit] = useState<Payroll | null>(null);
  const [form, setForm] = useState({ bonuses: '0', advances: '0', deductions: '0', notes: '' });

  useEffect(() => {
    if (edit) setForm({ bonuses: String(edit.bonuses), advances: String(edit.advances), deductions: String(edit.deductions), notes: edit.notes });
  }, [edit]);

  const compute = async () => {
    setComputing(true);
    const { data, error } = await supabase.rpc('compute_payroll', { p_month: period });
    setComputing(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('employees.computed', { count: data }));
    void rows.refetch();
  };

  const saveEdit = async () => {
    if (!edit) return;
    const nums = [form.bonuses, form.advances, form.deductions].map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return toast.error(t('validation.nonNegative'));
    const { error } = await supabase.from('payroll').update({ bonuses: nums[0], advances: nums[1], deductions: nums[2], notes: form.notes.trim() }).eq('id', edit.id);
    if (error) return toast.error(errorMessage(t, error));
    setEdit(null);
    void rows.refetch();
  };

  const markPaid = async (p: Payroll) => {
    const emp = names.get(p.employee_id);
    if (!(await confirm({ title: t('employees.markPaid'), body: t('employees.paidConfirm', { name: emp?.full_name ?? '', amount: f.money(Number(p.net_amount)) }) }))) return;
    const { error } = await supabase.from('payroll').update({ status: 'paid' }).eq('id', p.id);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('common.saved'));
    void rows.refetch();
  };

  const list = (rows.data ?? []).slice().sort((a, b) => (names.get(a.employee_id)?.full_name ?? '').localeCompare(names.get(b.employee_id)?.full_name ?? ''));
  const total = list.reduce((s, p) => s + Number(p.net_amount), 0);
  const columns: Column<Payroll>[] = [
    { key: 'emp', header: t('employees.shiftEmployee'), cell: (p) => <span className="font-semibold">{names.get(p.employee_id)?.full_name ?? t('common.unknown')}</span> },
    { key: 'hours', header: t('employees.hours'), hideBelow: 'md', cell: (p) => <span className="num">{f.number(Number(p.hours_worked), 1)}</span> },
    { key: 'base', header: t('employees.base'), cell: (p) => <span className="num">{f.money(Number(p.base_amount))}</span> },
    { key: 'bonus', header: t('employees.bonuses'), hideBelow: 'lg', cell: (p) => <span className="num text-success">{f.money(Number(p.bonuses))}</span> },
    { key: 'adv', header: t('employees.advances'), hideBelow: 'lg', cell: (p) => <span className="num text-warning">{f.money(Number(p.advances))}</span> },
    { key: 'ded', header: t('employees.deductions'), hideBelow: 'lg', cell: (p) => <span className="num text-danger">{f.money(Number(p.deductions))}</span> },
    { key: 'net', header: t('employees.net'), cell: (p) => <span className="num font-semibold text-fg">{f.money(Number(p.net_amount))}</span> },
    { key: 'status', header: t('common.status'), cell: (p) => <Badge tone={p.status === 'paid' ? 'green' : 'neutral'}>{p.status === 'paid' ? t('employees.paid') : t('employees.draft')}</Badge> },
    {
      key: 'act',
      header: '',
      align: 'end',
      cell: (p) =>
        p.status === 'draft' ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>{t('common.edit')}</Button>
            <Button size="sm" variant="success" icon={<HandCoins className="size-4" />} onClick={() => void markPaid(p)}>{t('employees.markPaid')}</Button>
          </div>
        ) : (
          <span className="num text-xs text-fg-3">{p.paid_at ? f.date(p.paid_at) : ''}</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <TextInput type="month" label={t('employees.month')} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Button variant="primary" className="mb-0.5" loading={computing} onClick={() => void compute()}>{t('employees.compute')}</Button>
        <Card className="ms-auto flex items-center gap-3 px-4 py-2.5">
          <Wallet className="size-5 text-fg" />
          <span className="text-sm text-fg-2">{t('employees.payrollTotal')}</span>
          <span className="num text-lg font-semibold">{f.money(total)}</span>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHeader title={f.monthYear(period)} className="pb-3" />
        <DataTable columns={columns} rows={list} rowKey={(p) => p.id} loading={rows.loading && !rows.data} empty={<EmptyState icon={<Wallet className="size-7" />} title={t('employees.payrollEmpty')} />} />
      </Card>
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        size="sm"
        title={edit ? t('employees.editPayroll', { name: names.get(edit.employee_id)?.full_name ?? '' }) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => void saveEdit()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <TextInput label={t('employees.bonuses')} type="number" inputMode="decimal" min={0} value={form.bonuses} onChange={(e) => setForm({ ...form, bonuses: e.target.value })} suffix="₪" />
          <TextInput label={t('employees.advances')} type="number" inputMode="decimal" min={0} value={form.advances} onChange={(e) => setForm({ ...form, advances: e.target.value })} suffix="₪" />
          <TextInput label={t('employees.deductions')} type="number" inputMode="decimal" min={0} value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} suffix="₪" />
          <Textarea label={t('common.notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          {edit && (
            <p className="num text-sm text-fg-2">
              {t('employees.net')}: <b className="text-fg">{f.money(Number(edit.base_amount) + (Number(form.bonuses) || 0) - (Number(form.advances) || 0) - (Number(form.deductions) || 0))}</b>
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

