import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Boxes, ChartColumn, ChevronLeft, ChevronRight, ClipboardList, Coins, CreditCard, Download, FileText, Landmark, Printer, Receipt, Sparkles, TrendingUp, Truck, Users, Vault } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/i18n';
import { downloadCsv } from '@/lib/csv';
import { printA4Report, type ReportSection } from '@/lib/print';
import { addDays, startOfWeek, toISODate } from '@/lib/dates';
import { useSettings } from '@/app/providers/SettingsProvider';
import { usePermissions } from '@/app/providers/PermissionsProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Tabs';
import { Button, IconButton } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Input';
import { InventoryReportsTab } from '@/features/inventory/components/InventoryReportsTab';
import { ProfitTab, SalesTab, type ExportSpec } from './components/ReportTabs';
import { ExpensesTab } from './components/ExpensesTab';
import { AssistantSection } from './components/Assistant';
import { CashSection, ItemsSold, OrderLog, SalesExtras, OrdersSection, PaymentsSection, PurchasesSection, StaffSection, TaxSection } from './components/Sections';

type Section = 'sales' | 'profit' | 'expenses' | 'orders' | 'payments' | 'staff' | 'inventory' | 'purchases' | 'tax' | 'cash' | 'assistant';
type Kind = 'day' | 'week' | 'month' | 'year' | 'custom';

const SECTIONS: { key: Section; label: TranslationKey; icon: ReactNode }[] = [
  { key: 'sales', label: 'reports.sales', icon: <TrendingUp className="size-4" /> },
  { key: 'profit', label: 'reports.profit', icon: <Coins className="size-4" /> },
  { key: 'expenses', label: 'reports.expenses', icon: <Receipt className="size-4" /> },
  { key: 'orders', label: 'rep.orders', icon: <ClipboardList className="size-4" /> },
  { key: 'payments', label: 'rep.payments', icon: <CreditCard className="size-4" /> },
  { key: 'staff', label: 'rep.staff', icon: <Users className="size-4" /> },
  { key: 'inventory', label: 'reports.inventory', icon: <Boxes className="size-4" /> },
  { key: 'purchases', label: 'rep.purchases', icon: <Truck className="size-4" /> },
  { key: 'tax', label: 'rep.tax', icon: <Landmark className="size-4" /> },
  { key: 'cash', label: 'rep.cash', icon: <Vault className="size-4" /> },
  { key: 'assistant', label: 'ai.title', icon: <Sparkles className="size-4" /> },
];

/** The period around `anchor`: the day, its week (from Saturday), month or year — never past today. */
function periodOf(kind: Exclude<Kind, 'custom'>, anchor: Date): { from: string; to: string } {
  const today = new Date();
  const cap = (d: Date) => (d > today ? today : d);
  if (kind === 'day') return { from: toISODate(anchor), to: toISODate(anchor) };
  if (kind === 'week') {
    const s = startOfWeek(anchor);
    return { from: toISODate(s), to: toISODate(cap(addDays(s, 6))) };
  }
  if (kind === 'month') {
    const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { from: toISODate(s), to: toISODate(cap(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))) };
  }
  const s = new Date(anchor.getFullYear(), 0, 1);
  return { from: toISODate(s), to: toISODate(cap(new Date(anchor.getFullYear(), 11, 31))) };
}

function shift(kind: Exclude<Kind, 'custom'>, anchor: Date, dir: 1 | -1): Date {
  const d = new Date(anchor);
  if (kind === 'day') d.setDate(d.getDate() + dir);
  else if (kind === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (kind === 'month') d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  return d;
}

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  // the staff section shows pay, so it also needs the employees grant
  const sections = SECTIONS.filter((s) => s.key !== 'staff' || can('employees'));
  const raw = params.get('tab') as Section | null;
  const section: Section = raw && sections.some((s) => s.key === raw) ? raw : 'sales';

  const [kind, setKind] = useState<Kind>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [custom, setCustom] = useState(() => ({ from: toISODate(addDays(new Date(), -29)), to: toISODate(new Date()) }));
  const range = useMemo(() => (kind === 'custom' ? custom : periodOf(kind, anchor)), [kind, custom, anchor]);
  const atEnd = kind !== 'custom' && range.to >= toISODate(new Date());

  const periodLabel = useMemo(() => {
    if (kind === 'day') return f.date(range.from);
    if (kind === 'month') return f.monthYear(range.from);
    if (kind === 'year') return f.digits(range.from.slice(0, 4));
    return `${f.date(range.from)} — ${f.date(range.to)}`;
  }, [kind, range.from, range.to, f]);

  // each part of a section registers what print / Excel should contain
  const specs = useRef(new Map<string, ExportSpec | null>());
  const registers = useRef(new Map<string, (s: ExportSpec | null) => void>());
  const registerFor = useCallback((key: string) => {
    let fn = registers.current.get(key);
    if (!fn) {
      fn = (s: ExportSpec | null) => {
        specs.current.set(key, s);
      };
      registers.current.set(key, fn);
    }
    return fn;
  }, []);
  const r = (key: string) => registerFor(`${section}:${key}`);

  const current = (): ExportSpec[] =>
    [...specs.current.entries()].filter(([k, s]) => k.startsWith(`${section}:`) && s).map(([, s]) => s as ExportSpec);
  const title = t(SECTIONS.find((s) => s.key === section)!.label);

  const print = (pdf = false) => {
    const list = current();
    if (!list.length) return;
    const out: ReportSection[] = list.flatMap((s) => s.sections);
    void printA4Report(
      t('reports.reportTitle', { name: title }),
      [t('reports.period', { from: f.date(range.from), to: f.date(range.to) }), t('reports.generatedAt', { date: f.dateTime(new Date()) })],
      out,
      { settings, title: pdf ? `MAX — ${title} — ${range.from}_${range.to}` : undefined },
      lang,
    );
  };
  const exportExcel = () => {
    // the detailed list (order log etc.) is the most useful sheet; otherwise the section summary
    const best = current().reduce<ExportSpec | null>((a, s) => (!a || s.csv.rows.length > a.csv.rows.length ? s : a), null);
    if (best) downloadCsv(`max-${section}-${range.from}_${range.to}`, best.csv.headers, best.csv.rows);
  };

  return (
    <div>
      <PageHeader
        title={t('reports.title')}
        icon={<ChartColumn className="size-6" />}
        actions={
          (
            <>
              <Button icon={<Printer className="size-4" />} onClick={() => print()}>{t('reports.printReport')}</Button>
              <Button icon={<FileText className="size-4" />} onClick={() => print(true)} title={t('rep.pdfHint')}>PDF</Button>
              <Button icon={<Download className="size-4" />} onClick={exportExcel}>{t('common.export')}</Button>
            </>
          )
        }
      />

      {(
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-panel border border-line bg-card p-3">
          <Segmented
            layoutId="rep-kind"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setAnchor(new Date());
            }}
            items={(['day', 'week', 'month', 'year', 'custom'] as Kind[]).map((k) => ({ key: k, label: t(`rep.kind.${k}`) }))}
          />
          {kind !== 'custom' ? (
            <div className="flex items-center gap-1">
              <IconButton label={t('rep.prev')} size="sm" onClick={() => setAnchor((a) => shift(kind, a, -1))}>
                <ChevronRight className="size-4 ltr:-scale-x-100" />
              </IconButton>
              <span className="num min-w-36 text-center text-sm text-fg">{periodLabel}</span>
              <IconButton label={t('rep.next')} size="sm" disabled={atEnd} onClick={() => setAnchor((a) => shift(kind, a, 1))}>
                <ChevronLeft className="size-4 ltr:-scale-x-100" />
              </IconButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <TextInput type="date" aria-label={t('common.from')} value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              <TextInput type="date" aria-label={t('common.to')} value={custom.to} min={custom.from} max={toISODate(new Date())} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          )}
          <span className="ms-auto text-xs text-fg-3">{t('rep.compareHint')}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[13.5rem_1fr]">
        <nav aria-label={t('reports.title')} className="no-scrollbar -mx-3 flex gap-1 overflow-x-auto px-3 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                params.set('tab', s.key);
                setParams(params, { replace: true });
              }}
              aria-current={section === s.key ? 'page' : undefined}
              className={cn(
                'relative flex h-10 shrink-0 items-center gap-2.5 rounded-btn px-3 text-sm whitespace-nowrap transition-colors lg:w-full',
                section === s.key ? 'bg-elevated text-fg shadow-glow-sm' : 'text-fg-2 hover:bg-fg/[0.04] hover:text-fg',
              )}
            >
              <span className="text-fg-3">{s.icon}</span>
              {t(s.label)}
              {section === s.key && <span className="slash ms-auto" aria-hidden />}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {section === 'sales' && (
            <>
              <SalesTab from={range.from} to={range.to} register={r('main')} />
              <SalesExtras range={range} />
              <ItemsSold range={range} register={r('items')} />
              <OrderLog range={range} register={r('log')} />
            </>
          )}
          {section === 'profit' && <ProfitTab from={range.from} to={range.to} register={r('main')} />}
          {section === 'expenses' && <ExpensesTab from={range.from} to={range.to} register={r('main')} />}
          {section === 'orders' && (
            <>
              <OrdersSection range={range} register={r('main')} />
              <OrderLog range={range} register={r('log')} />
            </>
          )}
          {section === 'payments' && <PaymentsSection range={range} register={r('main')} />}
          {section === 'staff' && <StaffSection range={range} register={r('main')} />}
          {section === 'inventory' && <InventoryReportsTab range={range} register={r('main')} />}
          {section === 'purchases' && <PurchasesSection range={range} register={r('main')} />}
          {section === 'tax' && <TaxSection range={range} register={r('main')} />}
          {section === 'cash' && <CashSection range={range} register={r('main')} />}
          {section === 'assistant' && <AssistantSection day={range.to} register={r('main')} />}
        </div>
      </div>
    </div>
  );
}
