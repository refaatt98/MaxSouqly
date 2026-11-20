import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Database, Download, Globe, Info, KeyRound, Printer as PrinterIcon, LogIn, LogOut, Settings as SettingsIcon, Upload, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n, type Language } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { downloadFile } from '@/lib/csv';
import { clearOfflineData } from '@/lib/offlineQueue';
import { hasErrors, v, type Errors } from '@/lib/validation';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/app/providers/AuthProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { BrandMark } from '@/app/shell/BrandMark';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { PrintersTab } from './PrintersTab';
import { InstallCard } from '@/app/shell/InstallCard';
import { Button } from '@/components/ui/Button';
import { TextInput, Textarea } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { Segmented } from '@/components/ui/Tabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { ImageUploader, useImageField } from '@/components/ui/ImageUploader';
import { PinModal } from '@/features/employees/components/EmployeesList';
import type { Settings } from '@/types/models';

type Tab = 'system' | 'interface' | 'backup' | 'about' | 'printers';

function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <div className="p-5">{children}</div>
    </Card>
  );
}

// ===================================================================== system
type Field =
  | 'name' | 'slogan' | 'phone' | 'address' | 'vat_percent' | 'receipt_header' | 'receipt_footer'
  | 'kitchen_warn_minutes' | 'kitchen_late_minutes' | 'table_count' | 'seating_capacity'
  | 'currency_symbol' | 'max_discount_cashier_percent' | 'max_discount_manager_percent' | 'payroll_cycle_day';

const FIELDS: Field[] = ['name', 'slogan', 'phone', 'address', 'vat_percent', 'receipt_header', 'receipt_footer', 'kitchen_warn_minutes', 'kitchen_late_minutes', 'table_count', 'seating_capacity', 'currency_symbol', 'max_discount_cashier_percent', 'max_discount_manager_percent', 'payroll_cycle_day'];

function SystemTab({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const { update } = useSettings();
  const toast = useToast();
  const logo = useImageField(settings.logo_url);
  const [form, setForm] = useState<Record<Field, string>>(() => Object.fromEntries(FIELDS.map((k) => [k, String(settings[k] ?? '')])) as Record<Field, string>);
  const [errors, setErrors] = useState<Errors<Field>>({});
  const [pending, setPending] = useState(false);
  const set = (k: Field, value: string) => setForm((s) => ({ ...s, [k]: value }));

  const toggle = async (key: 'offline_mode' | 'auto_sync' | 'order_notifications', value: boolean) => {
    try {
      await update({ [key]: value });
    } catch (err) {
      toast.error(errorMessage(t, err));
    }
  };
  const digitStyle = async (value: 'latin' | 'arabic') => {
    try {
      await update({ digit_style: value });
    } catch (err) {
      toast.error(errorMessage(t, err));
    }
  };

  const save = async () => {
    const int = (k: Field, min: number, max: number) => v.number(t, form[k], { integer: true, min, max });
    const e: Errors<Field> = {
      name: v.required(t, form.name) ?? v.maxLen(t, form.name, 60),
      vat_percent: v.number(t, form.vat_percent, { min: 0, max: 100 }),
      kitchen_warn_minutes: int('kitchen_warn_minutes', 1, 240),
      kitchen_late_minutes: int('kitchen_late_minutes', 1, 240) ?? (Number(form.kitchen_late_minutes) <= Number(form.kitchen_warn_minutes) ? t('validation.min', { min: Number(form.kitchen_warn_minutes) + 1 }) : null),
      table_count: int('table_count', 0, 500),
      seating_capacity: int('seating_capacity', 0, 5000),
      currency_symbol: v.required(t, form.currency_symbol) ?? v.maxLen(t, form.currency_symbol, 5),
      max_discount_cashier_percent: v.number(t, form.max_discount_cashier_percent, { min: 0, max: 100 }),
      max_discount_manager_percent: v.number(t, form.max_discount_manager_percent, { min: 0, max: 100 }),
      payroll_cycle_day: int('payroll_cycle_day', 1, 28),
    };
    setErrors(e);
    if (hasErrors(e)) return;
    setPending(true);
    try {
      await update({
        name: form.name.trim(),
        slogan: form.slogan.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        receipt_header: form.receipt_header.trim(),
        receipt_footer: form.receipt_footer.trim(),
        currency_symbol: form.currency_symbol.trim(),
        vat_percent: Number(form.vat_percent),
        kitchen_warn_minutes: Number(form.kitchen_warn_minutes),
        kitchen_late_minutes: Number(form.kitchen_late_minutes),
        table_count: Number(form.table_count),
        seating_capacity: Number(form.seating_capacity),
        max_discount_cashier_percent: Number(form.max_discount_cashier_percent),
        max_discount_manager_percent: Number(form.max_discount_manager_percent),
        payroll_cycle_day: Number(form.payroll_cycle_day),
        logo_url: logo.url,
      });
      await logo.commit();
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  const num = (k: Field, label: string, suffix?: string) => (
    <TextInput label={label} type="number" inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} error={errors[k]} suffix={suffix} />
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title={t('settings.restaurantInfo')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t('settings.restaurantName')} value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} required />
          <TextInput label={t('settings.slogan')} value={form.slogan} onChange={(e) => set('slogan', e.target.value)} />
          <TextInput label={t('common.phone')} dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          {num('vat_percent', t('settings.vat'), '%')}
          <TextInput className="sm:col-span-2" label={t('common.address')} value={form.address} onChange={(e) => set('address', e.target.value)} />
          <Textarea label={t('settings.receiptHeader')} value={form.receipt_header} onChange={(e) => set('receipt_header', e.target.value)} rows={2} />
          <Textarea label={t('settings.receiptFooter')} value={form.receipt_footer} onChange={(e) => set('receipt_footer', e.target.value)} rows={2} />
          <ImageUploader className="sm:col-span-2" label={t('settings.logo')} value={logo.url} onChange={logo.setUrl} folder="branding" />
        </div>
      </Section>
      <div className="space-y-4">
        <Section title={t('settings.features')}>
          <div className="divide-y divide-line">
            <Toggle id="s-offline" label={t('settings.offlineMode')} description={t('settings.offlineModeHint')} checked={settings.offline_mode} onChange={(val) => void toggle('offline_mode', val)} />
            <Toggle id="s-sync" label={t('settings.autoSync')} description={t('settings.autoSyncHint')} checked={settings.auto_sync} onChange={(val) => void toggle('auto_sync', val)} />
            <Toggle id="s-notif" label={t('settings.orderNotifications')} description={t('settings.orderNotificationsHint')} checked={settings.order_notifications} onChange={(val) => void toggle('order_notifications', val)} />
          </div>
        </Section>
        <Section title={t('settings.kitchen')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {num('kitchen_warn_minutes', t('settings.kitchenWarn'))}
            {num('kitchen_late_minutes', t('settings.kitchenLate'))}
            {num('table_count', t('settings.tableCount'))}
            {num('seating_capacity', t('settings.capacity'))}
          </div>
        </Section>
        <Section title={t('settings.money')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label={t('settings.currencySymbol')} value={form.currency_symbol} onChange={(e) => set('currency_symbol', e.target.value)} error={errors.currency_symbol} />
            <div>
              <p className="mb-1.5 text-sm font-medium text-fg-2">{t('settings.digitStyle')}</p>
              <Segmented layoutId="digits" className="w-full" value={settings.digit_style === 'arabic' ? 'arabic' : 'latin'} onChange={(val) => void digitStyle(val)} items={[{ key: 'latin', label: t('settings.digitLatin') }, { key: 'arabic', label: t('settings.digitArabic') }]} />
            </div>
            {num('max_discount_cashier_percent', t('settings.cashierDiscount'), '%')}
            {num('max_discount_manager_percent', t('settings.managerDiscount'), '%')}
            <TextInput
              className="sm:col-span-2"
              label={t('settings.payrollCycle')}
              hint={t('settings.payrollCycleHint', { day: form.payroll_cycle_day })}
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              value={form.payroll_cycle_day}
              onChange={(e) => set('payroll_cycle_day', e.target.value)}
              error={errors.payroll_cycle_day}
            />
          </div>
        </Section>
        <div className="flex justify-end">
          <Button variant="primary" size="lg" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </div>
      </div>
    </div>
  );
}

// ================================================================== interface
function InterfaceTab() {
  const { t, lang } = useI18n();
  const { profile, setLanguage, updateProfile } = useAuth();
  const { f } = useSettings();
  const toast = useToast();
  const avatar = useImageField(profile?.avatar_url ?? null);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [pending, setPending] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwPending, setPwPending] = useState(false);
  const changePassword = async () => {
    if (pw.next.length < 8) return setPwError(t('errors.WEAK_PASSWORD'));
    if (pw.next !== pw.confirm) return setPwError(t('settings.passwordMismatch'));
    setPwPending(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setPwPending(false);
    if (error) return setPwError(errorMessage(t, error));
    setPw({ next: '', confirm: '' });
    setPwError(null);
    toast.success(t('settings.passwordChanged'));
  };
  const employee = useQuery(async () => {
    const { data } = await supabase.from('employees_meta').select('id').eq('profile_id', profile?.id ?? '').maybeSingle();
    if (!data) return null;
    const { data: open } = await supabase.from('attendance').select('*').eq('employee_id', data.id).is('clock_out', null).maybeSingle();
    return { id: data.id, open };
  }, [profile?.id]);

  const saveProfile = async () => {
    if (fullName.trim().length < 2) return toast.error(t('validation.minLength', { min: 2 }));
    setPending(true);
    try {
      await updateProfile({ full_name: fullName.trim(), avatar_url: avatar.url });
      await avatar.commit();
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setPending(false);
    }
  };
  const clock = async (action: 'in' | 'out') => {
    const { error } = action === 'in' ? await supabase.rpc('clock_in', {}) : await supabase.rpc('clock_out', {});
    if (error) return toast.error(errorMessage(t, error));
    toast.success(action === 'in' ? t('employees.clockedIn') : t('employees.clockedOut'));
    void employee.refetch();
  };

  const langs: { code: Language; label: string; sample: string }[] = [
    { code: 'ar', label: 'عربي', sample: 'مرحباً بكم في MAX' },
    { code: 'he', label: 'עברית', sample: 'ברוכים הבאים ל־MAX' },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title={t('settings.language')} icon={<Globe className="size-5" />}>
        <p className="mb-4 text-sm text-fg-3">{t('settings.languageHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          {langs.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => void setLanguage(l.code)}
              aria-pressed={lang === l.code}
              lang={l.code}
              className={cn('rounded-card border p-5 text-start transition-[color,background-color,border-color,opacity,transform]', lang === l.code ? 'border-line-strong bg-elevated shadow-glow-sm' : 'border-line bg-surface hover:border-line-strong')}
            >
              <p className="flex items-center gap-2 text-lg font-medium">{lang === l.code && <span className="slash" aria-hidden />}{l.label}</p>
              <p className="mt-1 text-sm text-fg-3">{l.sample}</p>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('settings.myProfile')} icon={<User className="size-5" />}>
        <div className="space-y-4">
          <ImageUploader value={avatar.url} onChange={avatar.setUrl} folder="avatars" shape="circle" label={t('settings.avatar')} />
          <TextInput label={t('settings.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button icon={<KeyRound className="size-4" />} onClick={() => setPinOpen(true)}>{t('settings.myPin')}</Button>
            <Button variant="primary" loading={pending} onClick={() => void saveProfile()}>{t('common.save')}</Button>
          </div>
        </div>
      </Section>
      <Section title={t('settings.changePassword')} icon={<KeyRound className="size-5" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t('settings.newPassword')} type="password" dir="ltr" autoComplete="new-password" value={pw.next} onChange={(e) => { setPw({ ...pw, next: e.target.value }); setPwError(null); }} error={pwError} />
          <TextInput label={t('settings.confirmPassword')} type="password" dir="ltr" autoComplete="new-password" value={pw.confirm} onChange={(e) => { setPw({ ...pw, confirm: e.target.value }); setPwError(null); }} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" loading={pwPending} onClick={() => void changePassword()}>{t('settings.changePassword')}</Button>
        </div>
      </Section>
      {employee.data && (
        <Section title={t('employees.myClock')}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-2">{employee.data.open ? `${t('employees.onClock')} · ${f.time(employee.data.open.clock_in)}` : t('employees.clockIn')}</p>
            {employee.data.open ? (
              <Button icon={<LogOut className="size-4 rtl:-scale-x-100" />} onClick={() => void clock('out')}>{t('employees.clockOut')}</Button>
            ) : (
              <Button variant="primary" icon={<LogIn className="size-4 rtl:-scale-x-100" />} onClick={() => void clock('in')}>{t('employees.clockIn')}</Button>
            )}
          </div>
        </Section>
      )}
      <Section title={t('settings.offlineCache')} icon={<Database className="size-5" />}>
        <Button
          variant="outline"
          onClick={() =>
            void clearOfflineData().then(() => toast.success(t('settings.cacheCleared')))
          }
        >
          {t('settings.clearCache')}
        </Button>
      </Section>
      <PinModal target={pinOpen && profile ? { id: profile.id, name: profile.full_name } : null} onClose={() => setPinOpen(false)} />
    </div>
  );
}

// ===================================================================== backup
const BACKUP_TABLES = [
  'restaurant_settings', 'categories', 'menu_items', 'suppliers', 'ingredients', 'recipe_items',
  'employees_meta', 'expenses', 'purchase_orders', 'purchase_order_items', 'stock_counts', 'stock_count_items',
  'orders', 'order_items', 'payments', 'cash_shifts', 'stock_movements', 'work_shifts', 'attendance', 'payroll', 'notifications', 'audit_log',
] as const;

function BackupTab() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try {
      const out: Record<string, unknown> = { app: 'MAX', version: 1, exported_at: new Date().toISOString() };
      for (const table of BACKUP_TABLES) {
        const rows: unknown[] = [];
        // page through large tables (PostgREST caps responses)
        for (let fromRow = 0; ; fromRow += 1000) {
          const { data, error } = await supabase.from(table).select('*').range(fromRow, fromRow + 999);
          if (error) throw error;
          rows.push(...data);
          if (data.length < 1000) break;
        }
        out[table] = rows;
      }
      downloadFile(`max-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 1), 'application/json');
      toast.success(t('settings.backupExported'));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setExporting(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return toast.error(t('errors.INVALID_BACKUP'));
    }
    if (typeof parsed !== 'object' || parsed === null || (parsed as { app?: unknown }).app !== 'MAX') return toast.error(t('errors.INVALID_BACKUP'));
    if (!(await confirm({ title: t('settings.backupImport'), body: t('settings.backupConfirm') }))) return;
    setImporting(true);
    const { data, error } = await supabase.rpc('import_backup', { p_data: parsed as never });
    setImporting(false);
    if (error) return toast.error(errorMessage(t, error));
    const summary = Object.entries((data ?? {}) as Record<string, number>).map(([k, n]) => `${k}: ${n}`).join('، ');
    toast.success(t('settings.backupImported', { summary }));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title={t('settings.backupExport')} icon={<Download className="size-5" />}>
        <p className="mb-4 text-sm text-fg-3">{t('settings.backupExportHint')}</p>
        <Button variant="primary" loading={exporting} icon={<Download className="size-4" />} onClick={() => void exportAll()}>{t('settings.backupExport')}</Button>
      </Section>
      <Section title={t('settings.backupImport')} icon={<Upload className="size-5" />}>
        <p className="mb-4 text-sm text-fg-3">{t('settings.backupImportHint')}</p>
        <Button loading={importing} icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>{t('settings.backupChooseFile')}</Button>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </Section>
    </div>
  );
}

// ====================================================================== about
function AboutTab() {
  const { t } = useI18n();
  const shortcuts: [string, string][] = [
    ['Ctrl + K', t('topbar.commandHint')],
    ['F1 – F6', t('menu.categories')],
    ['Enter', t('pos.pay')],
    ['Esc', t('pos.cancel')],
  ];
  return (
    <Card className="relative overflow-hidden p-8">
      <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center">
        <img src="/images/login-burger.webp" alt="" className="w-40 drop-shadow-[0_16px_18px_rgba(0,0,0,0.45)]" />
        <div className="flex-1">
          <BrandMark size="lg" withSlogan />
          <p className="mt-4 max-w-xl text-fg-2">{t('settings.aboutBody')}</p>
          <p className="mono mt-4 text-sm text-fg-3">{t('app.version')}</p>
        </div>
      </div>
      <div className="relative mt-8">
        <InstallCard />
      </div>
      <div className="relative mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="mb-3 text-sm text-fg-3">{t('settings.shortcuts')}</p>
          <ul className="space-y-2 text-sm">
            {shortcuts.map(([k, label]) => (
              <li key={k} className="flex justify-between gap-2"><span className="text-fg-2">{label}</span><kbd className="mono rounded-[4px] border border-line bg-elevated px-1.5 text-[0.6875rem] text-fg-2" dir="ltr">{k}</kbd></li>
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 text-sm" dir="ltr">
          <p className="mb-3 text-fg-3">Environment</p>
          <p className="truncate text-fg-2">Supabase: {env.supabaseUrl.replace(/^https?:\/\//, '')}</p>
          <p className="truncate text-fg-2">R2 Worker: {env.r2WorkerUrl ? env.r2WorkerUrl.replace(/^https?:\/\//, '') : '—'}</p>
          <p className="text-fg-2">Build: {import.meta.env.MODE}</p>
        </div>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { role } = useAuth();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const isOwner = role === 'owner';
  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    ...(isOwner ? [{ key: 'system' as Tab, label: t('settings.system'), icon: <SettingsIcon className="size-4" /> }] : []),
    { key: 'interface', label: t('settings.interface'), icon: <Globe className="size-4" /> },
    ...(isOwner ? [{ key: 'printers' as Tab, label: t('printers.title'), icon: <PrinterIcon className="size-4" /> }] : []),
    ...(isOwner ? [{ key: 'backup' as Tab, label: t('settings.backup'), icon: <Database className="size-4" /> }] : []),
    { key: 'about', label: t('settings.about'), icon: <Info className="size-4" /> },
  ];
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && tabs.some((x) => x.key === raw) ? raw : tabs[0].key;

  useEffect(() => {
    document.title = `${t('settings.title')} — MAX`;
  }, [t]);

  return (
    <div>
      <PageHeader title={t('settings.title')} icon={<SettingsIcon className="size-6" />} />
      <Tabs
        className="mb-5"
        layoutId="set-tabs"
        value={tab}
        onChange={(k) => {
          params.set('tab', k);
          setParams(params, { replace: true });
        }}
        items={tabs}
      />
      {tab === 'system' && (settings ? <SystemTab key={settings.id} settings={settings} /> : <Skeleton className="h-96" />)}
      {tab === 'interface' && <InterfaceTab />}
      {tab === 'printers' && <PrintersTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'about' && <AboutTab />}
    </div>
  );
}
