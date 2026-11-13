import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Boxes, ChartColumn, Coins, Download, Printer, Receipt, TrendingUp, Users } from 'lucide-react';
import { useI18n } from '@/i18n';
import { downloadCsv } from '@/lib/csv';
import { printA4Report } from '@/lib/print';
import { presetRange, toISODate, type RangePreset } from '@/lib/dates';
import { useSettings } from '@/app/providers/SettingsProvider';
import { usePermissions } from '@/app/providers/PermissionsProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented, Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Input';
import { InventoryReportsTab } from '@/features/inventory/components/InventoryReportsTab';
import { EmployeesReportTab, ProfitTab, SalesTab, type ExportSpec } from './components/ReportTabs';
import { ExpensesTab } from './components/ExpensesTab';

type Tab = 'sales' | 'profit' | 'expenses' | 'inventory' | 'employees';
const TABS: Tab[] = ['sales', 'profit', 'expenses', 'inventory', 'employees'];

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const { can } = usePermissions();
  // the staff report shows pay, so it also needs the employees grant
  const tabs = TABS.filter((k) => k !== 'employees' || can('employees'));
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && tabs.includes(raw) ? raw : 'sales';
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [custom, setCustom] = useState(() => presetRange('30d'));
  const range = preset === 'custom' ? custom : presetRange(preset);

  // Each tab registers what print / export should produce.
  const exportRef = useRef<ExportSpec | null>(null);
  const register = useCallback((spec: ExportSpec | null) => {
    exportRef.current = spec;
  }, []);

  const print = () => {
    const spec = exportRef.current;
    if (!spec) return;
    void printA4Report(
      t('reports.reportTitle', { name: spec.title }),
      [t('reports.period', { from: f.date(range.from), to: f.date(range.to) }), t('reports.generatedAt', { date: f.dateTime(new Date()) })],
      spec.sections,
      { settings },
      lang,
    );
  };
  const exportCsv = () => {
    const spec = exportRef.current;
    if (spec) downloadCsv(`max-${tab}-${range.from}_${range.to}`, spec.csv.headers, spec.csv.rows);
  };

  return (
    <div>
      <PageHeader
        title={t('reports.title')}
        icon={<ChartColumn className="size-6" />}
        actions={
          tab !== 'inventory' && (
            <>
              <Button icon={<Printer className="size-4" />} onClick={print}>{t('reports.printReport')}</Button>
              <Button icon={<Download className="size-4" />} onClick={exportCsv}>{t('common.export')}</Button>
            </>
          )
        }
      />
      <Tabs
        className="mb-4"
        layoutId="rep-tabs"
        value={tab}
        onChange={(k) => {
          params.set('tab', k);
          setParams(params, { replace: true });
          exportRef.current = null;
        }}
        items={[
          { key: 'sales', label: t('reports.sales'), icon: <TrendingUp className="size-4" /> },
          { key: 'profit', label: t('reports.profit'), icon: <Coins className="size-4" /> },
          { key: 'expenses', label: t('reports.expenses'), icon: <Receipt className="size-4" /> },
          { key: 'inventory', label: t('reports.inventory'), icon: <Boxes className="size-4" /> },
          { key: 'employees' as Tab, label: t('reports.employees'), icon: <Users className="size-4" /> },
        ].filter((x) => tabs.includes(x.key as Tab))}
      />
      {tab !== 'inventory' && (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <Segmented
            layoutId="rep-range"
            value={preset}
            onChange={setPreset}
            items={[
              { key: 'today', label: t('reports.range.today') },
              { key: '7d', label: t('reports.range.7d') },
              { key: '30d', label: t('reports.range.30d') },
              { key: 'custom', label: t('reports.range.custom') },
            ]}
          />
          {preset === 'custom' && (
            <>
              <TextInput type="date" label={t('common.from')} value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              <TextInput type="date" label={t('common.to')} value={custom.to} min={custom.from} max={toISODate(new Date())} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
          <span className="num ms-auto pb-2 text-sm text-fg-3">{t('reports.period', { from: f.date(range.from), to: f.date(range.to) })}</span>
        </div>
      )}
      {tab === 'sales' && <SalesTab from={range.from} to={range.to} register={register} />}
      {tab === 'profit' && <ProfitTab from={range.from} to={range.to} register={register} />}
      {tab === 'expenses' && <ExpensesTab from={range.from} to={range.to} register={register} />}
      {tab === 'inventory' && <InventoryReportsTab />}
      {tab === 'employees' && <EmployeesReportTab from={range.from} to={range.to} register={register} />}
    </div>
  );
}
