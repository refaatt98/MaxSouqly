import { useEffect, useMemo, useState } from 'react';
import { Boxes, Download, Printer, Search, TriangleAlert, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { printA4Report, type ReportSection } from '@/lib/print';
import { presetRange } from '@/lib/dates';
import { INGREDIENT_COLS } from '@/lib/columns';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useCosts } from '@/hooks/useCosts';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { BarChart, ShareBars } from '@/components/ui/Chart';
import { DataTable } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Segmented } from '@/components/ui/Tabs';
import { fromJson, type Ingredient, type StockReason, type UnitType } from '@/types/models';
import type { CsvCell } from '@/lib/csv';

interface InventoryReport {
  stock_value?: number;
  items_count: number;
  low_stock: { id: string; name: string; name_he: string; unit: UnitType; quantity: number; min_quantity: number }[];
  by_reason: { reason: StockReason; count: number; value?: number }[];
  top_consumed: { id: string; name: string; name_he: string; unit: UnitType; quantity: number; value?: number }[];
}

type Spec = { title: string; sections: ReportSection[]; csv: { headers: string[]; rows: CsvCell[][] } };

/**
 * Inventory report. Inside the reports page it follows the shared period bar and print / Excel / PDF buttons
 * (`range` + `register`); on the inventory page it has its own period switch and buttons.
 * Money values show only for those allowed to see purchase costs.
 */
export function InventoryReportsTab({ range: outer, register }: { range?: { from: string; to: string }; register?: (s: Spec | null) => void }) {
  const { t, lang } = useI18n();
  const { f, settings, name } = useSettings();
  const costs = useCosts();
  const [preset, setPreset] = useState<'7d' | '30d'>('30d');
  const range = outer ?? presetRange(preset);
  const report = useQuery(async () => {
    const { data, error } = await supabase.rpc('report_inventory', { p_from: range.from, p_to: range.to });
    if (error) throw error;
    return fromJson<InventoryReport>(data);
  }, [range.from, range.to]);
  const stock = useQuery(async (): Promise<(Ingredient & { supplier: { name: string } | null })[]> => {
    const { data, error } = await supabase.from('ingredients').select(`${INGREDIENT_COLS}, supplier:suppliers(name)`).order('name_ar');
    if (error) throw error;
    return data as unknown as (Ingredient & { supplier: { name: string } | null })[];
  }, []);
  useLiveRefetch(['stock_movements', 'ingredients'], () => Promise.all([report.refetch(), stock.refetch()]), 1500);
  const r = report.data;
  const money = costs.allowed && r?.stock_value !== undefined;
  const waste = r?.by_reason.find((x) => x.reason === 'waste');
  // one meaning per color: waste is the figure that matters
  const colors: Record<StockReason, string> = { sale: '#b3aa9c', purchase: '#4cc38a', adjustment: '#b3aa9c', waste: '#e5484d', void: '#b3aa9c' };

  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const rows = useMemo(
    () =>
      (stock.data ?? []).filter((i) => {
        const low = Number(i.quantity) <= Number(i.min_quantity);
        if (level === 'low' && !low) return false;
        if (level === 'ok' && low) return false;
        const q = search.trim();
        return !q || i.name_ar.includes(q) || i.name_he.includes(q) || (i.supplier?.name ?? '').includes(q);
      }),
    [stock.data, search, level],
  );

  const spec = useMemo<Spec | null>(() => {
    if (!r) return null;
    return {
      title: t('reports.inventory'),
      sections: [
        {
          heading: t('inventory.reports'),
          kpis: [
            ...(money ? ([[t('inventory.totalValue'), f.money(Number(r.stock_value))]] as [string, string][]) : []),
            [t('inventory.itemsCount'), f.number(r.items_count)],
            [t('dashboard.lowStock'), f.number(r.low_stock.length)],
          ],
        },
        { heading: t('invReports.consumption'), table: { headers: [t('inventory.item'), t('common.quantity'), ...(money ? [t('inventory.value')] : [])], rows: r.top_consumed.map((c) => [c.name, `${f.number(c.quantity, 3)} ${t(`unit.${c.unit}`)}`, ...(money ? [f.money(Number(c.value))] : [])]) } },
        { heading: t('rep.stockList'), table: { headers: [t('inventory.item'), t('inventory.currentQty'), t('inventory.minQty'), t('inventory.supplier'), t('inventory.lastUpdate')], rows: rows.map((i) => [i.name_ar, `${f.number(Number(i.quantity), 3)} ${t(`unit.${i.unit}`)}`, f.number(Number(i.min_quantity), 3), i.supplier?.name ?? '—', f.dateTime(i.updated_at)]) } },
      ],
      csv: {
        headers: [t('inventory.item'), t('inventory.unit'), t('inventory.currentQty'), t('inventory.minQty'), t('inventory.supplier'), t('inventory.lastUpdate')],
        rows: rows.map((i) => [i.name_ar, t(`unit.${i.unit}`), Number(i.quantity), Number(i.min_quantity), i.supplier?.name ?? '', new Date(i.updated_at).toLocaleString('en-GB')]),
      },
    };
  }, [r, rows, money, t, f]);
  useEffect(() => register?.(spec), [register, spec]);

  const print = () =>
    spec &&
    void printA4Report(
      t('reports.reportTitle', { name: spec.title }),
      [t('reports.period', { from: f.date(range.from), to: f.date(range.to) }), t('reports.generatedAt', { date: f.dateTime(new Date()) })],
      spec.sections,
      { settings },
      lang,
    );

  if (report.error && !r) return <ErrorState message={errorMessage(t, report.error)} onRetry={() => void report.refetch()} retryLabel={t('common.retry')} />;

  return (
    <div className="space-y-4">
      {!outer && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented layoutId="inv-range" value={preset} onChange={setPreset} items={[{ key: '7d', label: t('reports.range.7d') }, { key: '30d', label: t('reports.range.30d') }]} />
          <div className="flex gap-2">
            <Button icon={<Printer className="size-4" />} onClick={print} disabled={!r}>{t('reports.printReport')}</Button>
            <Button icon={<Download className="size-4" />} onClick={() => spec && downloadCsv(`max-inventory-${range.from}_${range.to}`, spec.csv.headers, spec.csv.rows)} disabled={!r}>
              {t('common.export')}
            </Button>
          </div>
        </div>
      )}
      <div className={cn('grid grid-cols-2 gap-3', money ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
        {money && <StatCard label={t('inventory.totalValue')} value={Number(r?.stock_value ?? 0)} format={f.money} icon={<Wallet className="size-6" />} tone="gold" loading={!r} />}
        <StatCard label={t('inventory.itemsCount')} value={Number(r?.items_count ?? 0)} format={(n) => f.number(Math.round(n))} icon={<Boxes className="size-6" />} tone="blue" loading={!r} />
        <StatCard label={t('dashboard.lowStock')} value={r?.low_stock.length ?? 0} format={(n) => f.number(Math.round(n))} icon={<TriangleAlert className="size-6" />} tone="red" loading={!r} />
        <StatCard
          label={t('invReports.waste')}
          value={money ? Number(waste?.value ?? 0) : Number(waste?.count ?? 0)}
          format={money ? f.money : (n) => t('rep.movesCount', { count: f.number(Math.round(n)) })}
          loading={!r}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t('invReports.consumption')} />
          <div className="p-3">
            {r ? (
              <BarChart
                highlight={0}
                data={r.top_consumed.map((c) => ({
                  label: (lang === 'he' && c.name_he) || c.name,
                  value: money ? Number(c.value) : Number(c.quantity),
                  sublabel: `${f.number(c.quantity, 2)} ${t(`unit.${c.unit}`)}`,
                }))}
                format={money ? f.money : (n) => f.number(n, 2)}
                formatAxis={(n) => f.number(Math.round(n), 0)}
              />
            ) : (
              <Skeleton className="h-64" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t('invReports.movements')} />
          <div className="p-5">
            {r ? (
              <ShareBars
                format={money ? f.money : (n) => f.number(n)}
                items={r.by_reason.map((b) => ({ label: t(`inventory.reason.${b.reason}`), value: money ? Number(b.value) : Number(b.count), color: colors[b.reason] }))}
              />
            ) : (
              <Skeleton className="h-40" />
            )}
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHeader title={t('rep.stockList')} subtitle={t('rep.stockListHint')} />
        <div className="flex flex-wrap gap-2 p-4 pb-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('rep.searchStock')}
              aria-label={t('rep.searchStock')}
              className="h-10 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
            />
          </div>
          <Select
            aria-label={t('common.status')}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            options={[{ value: '', label: t('rep.allLevels') }, { value: 'low', label: t('dashboard.lowStock') }, { value: 'ok', label: t('inventory.status.ok') }]}
          />
        </div>
        <DataTable
          columns={[
            { key: 'n', header: t('inventory.item'), cell: (i) => <span className="text-fg">{name(i)}</span> },
            {
              key: 'q',
              header: t('inventory.currentQty'),
              cell: (i) => (
                <span className={cn('num', Number(i.quantity) <= Number(i.min_quantity) ? 'text-danger' : 'text-fg')}>
                  {f.number(Number(i.quantity), 3)} {t(`unit.${i.unit}`)}
                </span>
              ),
            },
            { key: 'm', header: t('inventory.minQty'), hideBelow: 'sm', cell: (i) => <span className="num text-fg-2">{f.number(Number(i.min_quantity), 3)}</span> },
            { key: 's', header: t('inventory.supplier'), hideBelow: 'md', cell: (i) => <span className="text-fg-2">{i.supplier?.name ?? '—'}</span> },
            { key: 'u', header: t('inventory.lastUpdate'), hideBelow: 'md', cell: (i) => <span className="num text-xs text-fg-3">{f.dateTime(i.updated_at)}</span> },
            {
              key: 'l',
              header: t('common.status'),
              align: 'end',
              cell: (i) => (Number(i.quantity) <= Number(i.min_quantity) ? <Badge tone="red">{t('dashboard.lowStock')}</Badge> : <Badge tone="green">{t('inventory.status.ok')}</Badge>),
            },
          ]}
          rows={rows}
          rowKey={(i) => i.id}
          empty={<p className="p-5 text-sm text-fg-3">{t('common.noResults')}</p>}
        />
      </Card>
    </div>
  );
}
