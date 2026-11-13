import { useEffect, useMemo } from 'react';
import { CalendarClock, Sparkles, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { percentChange } from '@/lib/format';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/Table';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fromJson, type UnitType } from '@/types/models';
import type { RegisterExport } from './ReportTabs';

interface Insights {
  days: number;
  forecast: { id: string; name: string; unit: UnitType; quantity: number; min_quantity: number; per_day: number; days_left: number | null }[];
  repeated_variances: { id: string; name: string; unit: UnitType; times: number; total: number }[];
  consumption: { id: string; name: string; unit: UnitType; by_recipe: number; waste: number; gap: number }[];
}

interface Daily {
  date: string;
  sales: number;
  orders: number;
  avg_day_sales: number;
  cancelled: number;
  unpaid: number;
  discounts: number;
  expenses: number;
  cogs: number | null;
  top_items: { name: string; qty: number }[];
  low_stock: { name: string; quantity: number; unit: UnitType; min: number }[];
  staff: { name: string; hours: number }[];
  absent: string[];
  advances: number;
}

/**
 * Owner analytics: how materials are being used, which ones keep coming out different at stocktake,
 * which will run out and when, and a one-page daily report. It helps decide — it never replaces the real count,
 * and it is only as accurate as the recipes entered for each item.
 */
export function AssistantSection({ day, register }: { day: string; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const insights = useQuery(async (): Promise<Insights> => {
    const { data, error } = await supabase.rpc('inventory_insights', { p_days: 14 });
    if (error) throw error;
    return fromJson<Insights>(data);
  }, []);
  const daily = useQuery(async (): Promise<Daily> => {
    const { data, error } = await supabase.rpc('daily_report', { p_date: day });
    if (error) throw error;
    return fromJson<Daily>(data);
  }, [day]);
  useLiveRefetch(['orders', 'stock_movements', 'stock_counts', 'expenses', 'attendance'], () => Promise.all([insights.refetch(), daily.refetch()]), 2000);

  const i = insights.data;
  const d = daily.data;
  const soon = useMemo(() => (i?.forecast ?? []).filter((x) => x.days_left !== null && x.days_left <= 7), [i]);
  const unit = (u: UnitType) => t(`unit.${u}`);

  // the daily report in words, built from the figures
  const notes = useMemo(() => {
    if (!d) return [];
    const out: string[] = [];
    const vs = percentChange(Number(d.sales), Number(d.avg_day_sales));
    out.push(t('ai.salesLine', { sales: f.money(Number(d.sales)), orders: f.number(d.orders) }) + (vs !== null && Number(d.avg_day_sales) > 0 ? ' ' + t(vs >= 0 ? 'ai.aboveAvg' : 'ai.belowAvg', { pct: f.number(Math.abs(vs), 0) }) : ''));
    if (d.top_items.length) out.push(t('ai.topLine', { items: d.top_items.slice(0, 3).map((x) => `${x.name} (${f.number(Number(x.qty))})`).join('، ') }));
    if (d.cancelled > 0) out.push(t('ai.cancelLine', { count: f.number(d.cancelled) }));
    if (Number(d.unpaid) > 0) out.push(t('ai.unpaidLine', { amount: f.money(Number(d.unpaid)) }));
    if (d.cogs !== null) out.push(t('ai.marginLine', { profit: f.money(Number(d.sales) - Number(d.cogs) - Number(d.expenses)) }));
    if (soon.length) out.push(t('ai.runOutLine', { items: soon.slice(0, 4).map((x) => `${x.name} (${f.number(Number(x.days_left), 1)} ${t('ai.daysShort')})`).join('، ') }));
    if (d.low_stock.length) out.push(t('ai.lowLine', { count: f.number(d.low_stock.length) }));
    if ((i?.repeated_variances ?? []).length) out.push(t('ai.varianceLine', { items: (i?.repeated_variances ?? []).slice(0, 3).map((x) => x.name).join('، ') }));
    if (d.absent.length) out.push(t('ai.absentLine', { names: d.absent.join('، ') }));
    if (Number(d.advances) > 0) out.push(t('ai.advancesLine', { amount: f.money(Number(d.advances)) }));
    return out;
  }, [d, i, soon, t, f]);

  useEffect(() => {
    if (!d || !i) return register(null);
    register({
      title: t('ai.title'),
      sections: [
        { heading: t('ai.daily', { date: f.date(d.date) }), kpis: [[t('reports.totalSales'), f.money(Number(d.sales))], [t('reports.ordersCount'), f.number(d.orders)], [t('reports.expensesTotal'), f.money(Number(d.expenses))], [t('rep.outstanding'), f.money(Number(d.unpaid))]] },
        { heading: t('ai.summary'), table: { headers: [''], rows: notes.map((n) => [n]) } },
        { heading: t('ai.forecast'), table: { headers: [t('inventory.item'), t('inventory.currentQty'), t('ai.perDay'), t('ai.daysLeft')], rows: i.forecast.map((x) => [x.name, `${f.number(Number(x.quantity), 3)} ${unit(x.unit)}`, `${f.number(Number(x.per_day), 3)} ${unit(x.unit)}`, x.days_left === null ? '—' : f.number(Number(x.days_left), 1)]) } },
        { heading: t('ai.variances'), table: { headers: [t('inventory.item'), t('ai.times'), t('ai.totalDiff')], rows: i.repeated_variances.map((x) => [x.name, f.number(x.times), `${f.number(Number(x.total), 3)} ${unit(x.unit)}`]) } },
      ],
      csv: { headers: [t('inventory.item'), t('inventory.currentQty'), t('ai.perDay'), t('ai.daysLeft')], rows: i.forecast.map((x) => [x.name, Number(x.quantity), Number(x.per_day), x.days_left ?? '']) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, i, notes, register]);

  if ((insights.error && !i) || (daily.error && !d)) {
    return <ErrorState message={errorMessage(t, insights.error ?? daily.error)} onRetry={() => void Promise.all([insights.refetch(), daily.refetch()])} retryLabel={t('common.retry')} />;
  }
  if (!i || !d) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-5 text-fg-3" strokeWidth={1.5} />
          <h2 className="text-[0.9375rem] font-medium text-fg">{t('ai.daily', { date: f.date(d.date) })}</h2>
        </div>
        <ul className="space-y-2 text-sm text-fg-2">
          {notes.map((n, k) => (
            <li key={k} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-fg-3" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-fg-3">{t('ai.disclaimer')}</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title={t('ai.forecast')} subtitle={t('ai.forecastHint', { days: f.number(i.days) })} icon={<CalendarClock className="size-5" />} />
          <DataTable
            columns={[
              { key: 'n', header: t('inventory.item'), cell: (x) => <span className="text-fg">{x.name}</span> },
              { key: 'q', header: t('inventory.currentQty'), cell: (x) => <span className="num">{f.number(Number(x.quantity), 3)} {unit(x.unit)}</span> },
              { key: 'p', header: t('ai.perDay'), hideBelow: 'sm', cell: (x) => <span className="num text-fg-2">{f.number(Number(x.per_day), 3)}</span> },
              {
                key: 'd',
                header: t('ai.daysLeft'),
                align: 'end',
                cell: (x) =>
                  x.days_left === null ? (
                    '—'
                  ) : (
                    <Badge tone={x.days_left <= 2 ? 'red' : x.days_left <= 7 ? 'amber' : 'neutral'}>
                      {f.number(Number(x.days_left), 1)} {t('ai.daysShort')}
                    </Badge>
                  ),
              },
            ]}
            rows={i.forecast.slice(0, 25)}
            rowKey={(x) => x.id}
            empty={<p className="p-5 text-sm text-fg-3">{t('ai.noData')}</p>}
          />
        </Card>
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader title={t('ai.variances')} subtitle={t('ai.variancesHint')} icon={<TriangleAlert className="size-5" />} />
            <DataTable
              columns={[
                { key: 'n', header: t('inventory.item'), cell: (x) => <span className="text-fg">{x.name}</span> },
                { key: 't', header: t('ai.times'), cell: (x) => <span className="num">{f.number(x.times)}</span> },
                { key: 'v', header: t('ai.totalDiff'), align: 'end', cell: (x) => <span className={cn('num', Number(x.total) < 0 ? 'text-danger' : 'text-success')}>{f.number(Number(x.total), 3)} {unit(x.unit)}</span> },
              ]}
              rows={i.repeated_variances}
              rowKey={(x) => x.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('ai.noVariances')}</p>}
            />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title={t('ai.consumption')} subtitle={t('ai.consumptionHint')} />
            <DataTable
              columns={[
                { key: 'n', header: t('inventory.item'), cell: (x) => <span className="text-fg">{x.name}</span> },
                { key: 'r', header: t('ai.byRecipe'), cell: (x) => <span className="num">{f.number(Number(x.by_recipe), 3)}</span> },
                { key: 'w', header: t('inventory.reason.waste'), hideBelow: 'sm', cell: (x) => <span className="num text-fg-2">{f.number(Number(x.waste), 3)}</span> },
                { key: 'g', header: t('ai.gap'), align: 'end', cell: (x) => <span className={cn('num', Math.abs(Number(x.gap)) > 0.0005 && 'text-warning')}>{f.number(Number(x.gap), 3)} {unit(x.unit)}</span> },
              ]}
              rows={i.consumption}
              rowKey={(x) => x.id}
              empty={<p className="p-5 text-sm text-fg-3">{t('ai.noData')}</p>}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
