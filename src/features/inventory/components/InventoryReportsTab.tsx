import { useState } from 'react';
import { Boxes, Download, Printer, TriangleAlert, Wallet } from 'lucide-react';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { printA4Report } from '@/lib/print';
import { presetRange } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { BarChart, ShareBars } from '@/components/ui/Chart';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Segmented } from '@/components/ui/Tabs';
import { fromJson, type StockReason, type UnitType } from '@/types/models';

interface InventoryReport {
  stock_value: number;
  items_count: number;
  low_stock: { id: string; name: string; name_he: string; unit: UnitType; quantity: number; min_quantity: number }[];
  by_reason: { reason: StockReason; count: number; value: number }[];
  top_consumed: { id: string; name: string; name_he: string; unit: UnitType; quantity: number; value: number }[];
}

export function InventoryReportsTab() {
  const { t, lang } = useI18n();
  const { f, settings, name } = useSettings();
  const [preset, setPreset] = useState<'7d' | '30d'>('30d');
  const range = presetRange(preset);
  const report = useQuery(async () => {
    const { data, error } = await supabase.rpc('report_inventory', { p_from: range.from, p_to: range.to });
    if (error) throw error;
    return fromJson<InventoryReport>(data);
  }, [range.from, range.to]);
  useLiveRefetch(['stock_movements', 'ingredients'], report.refetch, 1500);
  const r = report.data;
  const waste = Number(r?.by_reason.find((x) => x.reason === 'waste')?.value ?? 0);
  const colors: Record<StockReason, string> = { sale: '#E11D2E', purchase: '#22C55E', adjustment: '#2563EB', waste: '#F59E0B', void: '#F5B301' };

  const exportCsv = () =>
    r &&
    downloadCsv(
      `max-inventory-report-${range.from}_${range.to}`,
      [t('inventory.item'), t('common.quantity'), t('inventory.unit'), t('inventory.value')],
      r.top_consumed.map((c) => [c.name, Number(c.quantity), t(`unit.${c.unit}`), Number(c.value)]),
    );
  const print = () =>
    r &&
    void printA4Report(
      t('reports.reportTitle', { name: t('reports.inventory') }),
      [t('reports.period', { from: f.date(range.from), to: f.date(range.to) }), t('reports.generatedAt', { date: f.dateTime(new Date()) })],
      [
        { heading: t('inventory.reports'), kpis: [[t('inventory.totalValue'), f.money(r.stock_value)], [t('inventory.itemsCount'), f.number(r.items_count)], [t('dashboard.lowStock'), f.number(r.low_stock.length)], [t('invReports.waste'), f.money(waste)]] },
        { heading: t('invReports.consumption'), table: { headers: [t('inventory.item'), t('common.quantity'), t('inventory.value')], rows: r.top_consumed.map((c) => [c.name, `${f.number(c.quantity, 3)} ${t(`unit.${c.unit}`)}`, f.money(c.value)]) } },
        { heading: t('invReports.lowList'), table: { headers: [t('inventory.item'), t('inventory.currentQty'), t('inventory.minQty')], rows: r.low_stock.map((c) => [c.name, f.number(c.quantity, 3), f.number(c.min_quantity, 3)]) } },
      ],
      { settings },
      lang,
    );

  if (report.error && !r) return <ErrorState message={errorMessage(t, report.error)} onRetry={() => void report.refetch()} retryLabel={t('common.retry')} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented layoutId="inv-range" value={preset} onChange={setPreset} items={[{ key: '7d', label: t('reports.range.7d') }, { key: '30d', label: t('reports.range.30d') }]} />
        <div className="flex gap-2">
          <Button icon={<Printer className="size-4" />} onClick={print} disabled={!r}>{t('reports.printReport')}</Button>
          <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!r}>{t('common.export')}</Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={t('inventory.totalValue')} value={Number(r?.stock_value ?? 0)} format={f.money} icon={<Wallet className="size-6" />} tone="gold" loading={!r} />
        <StatCard label={t('inventory.itemsCount')} value={Number(r?.items_count ?? 0)} format={(n) => f.number(Math.round(n))} icon={<Boxes className="size-6" />} tone="blue" loading={!r} />
        <StatCard label={t('invReports.waste')} value={waste} format={f.money} icon={<TriangleAlert className="size-6" />} tone="red" loading={!r} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t('invReports.consumption')} />
          <div className="p-3">
            {r ? (
              <BarChart color="gold" data={r.top_consumed.map((c) => ({ label: (lang === 'he' && c.name_he) || c.name, value: Number(c.value), sublabel: `${f.number(c.quantity, 2)} ${t(`unit.${c.unit}`)}` }))} format={f.money} formatAxis={(n) => f.number(Math.round(n), 0)} />
            ) : (
              <Skeleton className="h-64" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t('invReports.movements')} />
          <div className="p-5">
            {r ? <ShareBars format={f.money} items={r.by_reason.map((b) => ({ label: t(`inventory.reason.${b.reason}`), value: Number(b.value), color: colors[b.reason] }))} /> : <Skeleton className="h-40" />}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title={t('invReports.lowList')} />
        <ul className="grid gap-2 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {(r?.low_stock ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-card border border-danger/25 bg-danger/5 px-4 py-3">
              <span className="font-semibold">{name({ name_ar: l.name, name_he: l.name_he })}</span>
              <span className="num text-sm text-danger">
                {f.number(l.quantity, 3)} / {f.number(l.min_quantity, 3)} {t(`unit.${l.unit}`)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
