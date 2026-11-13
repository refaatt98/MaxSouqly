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
import { useDeleteRecord, useDeleteMany } from '@/app/providers/DeleteProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column, BulkBar, useSelection } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ROLES, type AppRole, type Attendance, type Payroll, type Profile, type UserPermission } from '@/types/models';
import type { Permission } from '@/app/providers/PermissionsProvider';
import { GrantsModal } from './GrantsModal';
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
  const [picking, setPicking] = useState(false);
  const shiftSel = useSelection((shifts.data ?? []).map((s) => s.id));
  const removeShifts = useDeleteMany();
  const bulkShifts = () =>
    void removeShifts('work_shift', [...shiftSel.ids]).then((ok) => {
      if (!ok) return;
      shiftSel.clear();
      setPicking(false);
      void shifts.refetch();
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label={t('employees.prevWeek')} onClick={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft className="size-5 rtl:-scale-x-100" /></IconButton>
          <Button variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>{t('employees.thisWeek')}</Button>
          <IconButton label={t('employees.nextWeek')} onClick={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight className="size-5 rtl:-scale-x-100" /></IconButton>
          <span className="num ms-2 text-sm font-semibold text-fg-2">{f.shortDate(days[0])} — {f.shortDate(days[6])}</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant={picking ? 'secondary' : 'ghost'}
            aria-pressed={picking}
            onClick={() => {
              setPicking((v) => !v);
              shiftSel.clear();
            }}
          >
            {t('bulk.select')}
          </Button>
          <Button variant="primary" onClick={() => setDraft({ employee_id: active[0]?.id ?? '', date: today >= from && today <= to ? today : from, start: '10:00', end: '18:00', notes: '' })}>
            {t('employees.addShift')}
          </Button>
        </div>
      </div>
      <Card className="overflow-x-auto">
        {shifts.loading && !shifts.data ? (
          <SkeletonRows rows={6} />
        ) : (
          <table className="w-full min-w-[56.25rem] border-separate border-spacing-0 text-sm">
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
                      <td key={date} className={cn('h-16 border-b border-s border-line p-1 align-top', date === today && 'bg-fg/[0.02]')}>
                        <div className="flex h-full flex-col gap-1">
                          {list.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              aria-pressed={picking ? shiftSel.has(s.id) : undefined}
                              onClick={() =>
                                picking
                                  ? shiftSel.toggle(s.id)
                                  : setDraft({ id: s.id, employee_id: s.employee_id, date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), notes: s.notes })
                              }
                              className={cn(
                                'num rounded-btn px-2 py-1 text-[0.6875rem] font-semibold',
                                Number(s.start_time.slice(0, 2)) < 14 ? 'bg-elevated text-fg' : 'bg-elevated text-fg-2',
                                shiftSel.has(s.id) && 'bg-brand text-white ring-2 ring-brand/40',
                              )}
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
                              className="h-full min-h-10 w-full rounded-btn text-lg text-transparent transition-colors hover:bg-fg/5 hover:text-fg-3"
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
      <BulkBar selection={shiftSel} onDelete={bulkShifts} />
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
  const [granting, setGranting] = useState<Profile | null>(null);
  const grants = useQuery(async (): Promise<UserPermission[]> => {
    const { data, error } = await supabase.from('user_permissions').select('*');
    if (error) throw error;
    return data;
  }, []);
  useLiveRefetch(['user_permissions'], grants.refetch);

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
    {
      key: 'grants',
      header: t('perm.column'),
      cell: (u) => {
        if (u.role === 'owner') return <span className="text-xs text-fg-3">{t('perm.all')}</span>;
        const mine = (grants.data ?? []).filter((g) => g.user_id === u.id && (!g.expires_at || new Date(g.expires_at) > new Date()));
        return (
          <div className="flex flex-wrap items-center gap-1">
            {mine.map((g) => (
              <Badge key={g.permission} tone={g.expires_at ? 'amber' : 'neutral'}>
                {t(`perm.${g.permission as Permission}`)}
                {g.expires_at && <span className="num"> · {f.date(g.expires_at)}</span>}
              </Badge>
            ))}
            {mine.length === 0 && <span className="text-xs text-fg-3">{t('perm.none')}</span>}
            {isOwner && (
              <Button size="sm" variant="ghost" onClick={() => setGranting(u)}>
                {t('perm.edit')}
              </Button>
            )}
          </div>
        );
      },
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
      <GrantsModal user={granting} grants={grants.data ?? []} onClose={() => setGranting(null)} onSaved={() => void grants.refetch()} />
    </>
  );
}

// ================================================================= attendance
export function AttendanceTab({ employees }: { employees: EmployeeRow[] }) {
  const t = useT();
  const { f } = useSettings();
  const { profile, role } = useAuth();
  const toast = useToast();
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
  const removeRecord = useDeleteRecord();
  const manager = role === 'owner' || role === 'manager';
  const [entry, setEntry] = useState<{ id: string | null; employee: string; day: string; inAt: string; outAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const openNew = () => {
    const now = new Date();
    setEntry({ id: null, employee: '', day: toISODate(now), inAt: hhmm(now.toISOString()), outAt: '' });
  };
  const openEdit = (a: Attendance) => {
    if (!manager) return;
    setEntry({ id: a.id, employee: a.employee_id, day: toISODate(new Date(a.clock_in)), inAt: hhmm(a.clock_in), outAt: a.clock_out ? hhmm(a.clock_out) : '' });
  };
  const saveEntry = async () => {
    if (!entry) return;
    if (!entry.employee) return toast.error(t('common.required'));
    const inAt = new Date(`${entry.day}T${entry.inAt}`);
    let outAt: Date | null = null;
    if (entry.outAt) {
      outAt = new Date(`${entry.day}T${entry.outAt}`);
      if (outAt.getTime() === inAt.getTime()) return toast.error(t('att.outBeforeIn'));
      if (outAt < inAt) outAt = addDays(outAt, 1); // overnight shift
    }
    const row = { employee_id: entry.employee, clock_in: inAt.toISOString(), clock_out: outAt ? outAt.toISOString() : null };
    setSaving(true);
    const { error } = entry.id ? await supabase.from('attendance').update(row).eq('id', entry.id) : await supabase.from('attendance').insert(row);
    setSaving(false);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('common.saved'));
    setEntry(null);
    void rows.refetch();
  };
  const clockOutNow = async (a: Attendance) => {
    const { error } = await supabase.from('attendance').update({ clock_out: new Date().toISOString() }).eq('id', a.id);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('employees.clockedOut'));
    void rows.refetch();
  };
  const clockInNow = async (employeeId: string) => {
    const { error } = await supabase.from('attendance').insert({ employee_id: employeeId });
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t('employees.clockedIn'));
    setEntry(null);
    void rows.refetch();
  };

  const totalHours = (rows.data ?? []).filter((a) => !a.absent).reduce((s, a) => s + hoursBetween(a.clock_in, a.clock_out), 0);
  const columns: Column<Attendance>[] = [
    { key: 'emp', header: t('employees.shiftEmployee'), cell: (a) => <span className="font-semibold">{names.get(a.employee_id)?.full_name ?? t('common.unknown')}</span> },
    {
      key: 'in',
      header: t('employees.clockInAt'),
      cell: (a) => (a.absent ? <span className="text-danger">{t('att.absent')} · <span className="num">{f.date(a.clock_in)}</span></span> : <span className="num">{f.dateTime(a.clock_in)}</span>),
    },
    {
      key: 'out',
      header: t('employees.clockOutAt'),
      cell: (a) =>
        a.absent ? (
          '—'
        ) : a.clock_out ? (
          <span className="num">{f.time(a.clock_out)}</span>
        ) : manager ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<LogOut className="size-4 rtl:-scale-x-100" />}
            onClick={(e) => {
              e.stopPropagation();
              void clockOutNow(a);
            }}
          >
            {t('att.nowOut')}
          </Button>
        ) : (
          <Badge tone="blue">{t('employees.stillOnClock')}</Badge>
        ),
    },
    { key: 'dur', header: t('employees.duration'), align: 'end', cell: (a) => (a.absent ? '—' : <span className="num font-semibold">{f.number(hoursBetween(a.clock_in, a.clock_out), 1)} {t('common.hoursShort')}</span>) },
    ...(manager
      ? [
          {
            key: 'x',
            header: '',
            align: 'end' as const,
            cell: (a: Attendance) => (
              <IconButton
                label={t('del.button')}
                size="sm"
                className="hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeRecord('attendance', a.id, names.get(a.employee_id)?.full_name ?? '').then((ok) => ok && void rows.refetch());
                }}
              >
                <Trash className="size-4" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  const sel2 = useSelection((rows.data ?? []).map((x) => x.id));
  const removeMany2 = useDeleteMany();
  const bulkDelete2 = () =>
    void removeMany2('attendance', [...sel2.ids]).then((ok) => {
      if (ok) {
        sel2.clear();
        void rows.refetch();
      }
    });

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
        {manager && (
          <Button variant="primary" className="mb-0.5" onClick={openNew}>
            {t('att.add')}
          </Button>
        )}
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
        <DataTable selection={manager ? sel2 : undefined}
          columns={columns}
          rows={rows.data ?? []}
          rowKey={(a) => a.id}
          onRowClick={manager ? openEdit : undefined}
          loading={rows.loading && !rows.data}
          empty={<EmptyState icon={<CalendarDays className="size-7" />} title={t('employees.attendanceEmpty')} />}
        />
      </Card>
      {manager && <BulkBar selection={sel2} onDelete={bulkDelete2} />}
      <Modal
        open={entry !== null}
        onClose={() => setEntry(null)}
        size="sm"
        title={entry?.id ? t('att.editTitle') : t('att.title')}
        footer={
          <>
            {entry && !entry.id && entry.employee && !(rows.data ?? []).some((a) => a.employee_id === entry.employee && !a.clock_out) && (
              <Button variant="secondary" className="me-auto" icon={<LogIn className="size-4 rtl:-scale-x-100" />} onClick={() => void clockInNow(entry.employee)}>
                {t('att.nowIn')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEntry(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saving} onClick={() => void saveEntry()}>{t('common.save')}</Button>
          </>
        }
      >
        {entry && (
          <div className="space-y-3">
            <Select
              label={t('employees.shiftEmployee')}
              value={entry.employee}
              disabled={entry.id !== null}
              placeholder="—"
              onChange={(e) => setEntry({ ...entry, employee: e.target.value })}
              options={employees.filter((e) => e.is_active || e.id === entry.employee).map((e) => ({ value: e.id, label: e.full_name }))}
            />
            <TextInput type="date" label={t('att.day')} value={entry.day} onChange={(e) => e.target.value && setEntry({ ...entry, day: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput type="time" label={t('att.in')} value={entry.inAt} onChange={(e) => e.target.value && setEntry({ ...entry, inAt: e.target.value })} />
              <TextInput type="time" label={t('att.out')} hint={t('att.outHint')} value={entry.outAt} onChange={(e) => setEntry({ ...entry, outAt: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ==================================================================== payroll
export function PayrollTab({ employees }: { employees: EmployeeRow[] }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const removeRecord = useDeleteRecord();
  const [month, setMonth] = useState(() => toISODate(startOfMonth(new Date())).slice(0, 7));
  const period = `${month}-01`;
  const { settings } = useSettings();
  const cycleDay = settings?.payroll_cycle_day ?? 1;
  const cycle = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return null;
    return { from: new Date(y, m - 1, cycleDay).toISOString(), to: new Date(y, m, cycleDay - 1).toISOString() };
  }, [month, cycleDay]);
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
    {
      key: 'hours',
      header: t('employees.worked'),
      hideBelow: 'md',
      cell: (p) =>
        names.get(p.employee_id)?.salary_type === 'daily' ? (
          <span className="num">{t('employees.daysCount', { count: f.number(p.days_worked) })}</span>
        ) : (
          <span className="num">{f.number(Number(p.hours_worked), 1)} {t('common.hoursShort')}</span>
        ),
    },
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
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          {p.status === 'draft' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>{t('common.edit')}</Button>
              <Button size="sm" variant="success" icon={<HandCoins className="size-4" />} onClick={() => void markPaid(p)}>{t('employees.markPaid')}</Button>
            </>
          ) : (
            <span className="num text-xs text-fg-3">{p.paid_at ? f.date(p.paid_at) : ''}</span>
          )}
          <IconButton
            label={t('del.button')}
            size="sm"
            className="hover:text-danger"
            onClick={() => void removeRecord('payroll', p.id, names.get(p.employee_id)?.full_name ?? '').then((ok) => ok && void rows.refetch())}
          >
            <Trash className="size-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const sel3 = useSelection((list).map((x) => x.id));
  const removeMany3 = useDeleteMany();
  const bulkDelete3 = () =>
    void removeMany3('payroll', [...sel3.ids]).then((ok) => {
      if (ok) {
        sel3.clear();
        void rows.refetch();
      }
    });

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
        <CardHeader title={f.monthYear(period)} subtitle={cycle ? t('employees.cycleRange', { from: f.date(cycle.from), to: f.date(cycle.to) }) : undefined} className="pb-3" />
        <DataTable selection={sel3} columns={columns} rows={list} rowKey={(p) => p.id} loading={rows.loading && !rows.data} empty={<EmptyState icon={<Wallet className="size-7" />} title={t('employees.payrollEmpty')} />} />
      </Card>
      <BulkBar selection={sel3} onDelete={bulkDelete3} />
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

