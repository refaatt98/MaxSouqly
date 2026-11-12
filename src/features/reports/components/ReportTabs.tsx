import { useEffect, useMemo } from 'react';
import { Armchair, Banknote, Bike, Coins, CreditCard, Percent, Receipt, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { percentChange } from '@/lib/format';
import { parseISODate, satIndex } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { BarChart, Heatmap, LineChart, ShareBars } from '@/components/ui/Chart';
import { DataTable, type Column } from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';
import { FoodImage } from '@/components/ui/FoodImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import type { ReportSection } from '@/lib/print';
import type { CsvCell } from '@/lib/csv';
import { fetchCashiers, fetchEmployeeReport, fetchHourly, fetchProfit, fetchSales, fetchTopItems, type CashierRow, type EmployeeReportRow } from '../api';

export interface ExportSpec {
  title: string;
  sections: ReportSection[];
  csv: { headers: string[]; rows: CsvCell[][] };
}

/** Reports register what "print" and "export" should produce for the current tab. */
export type RegisterExport = (spec: ExportSpec | null) => void;

function useDayLabel() {
  const { t } = useI18n();
  const { f } = useSettings();
  return (iso: string, days: number) => {
    const d = parseISODate(iso);
    return days <= 7 ? t(`day.${satIndex(d)}` as 'day.0') : f.shortDate(d);
  };
}

// ===================================================================== sales
export function SalesTab({ from, to, register }: { from: string; to: string; register: RegisterExport }) {
  const { t } = useI18n();
  const { f, name } = useSettings();
  const dayLabel = useDayLabel();
  const sales = useQuery(() => fetchSales(from, to), [from, to]);
  const top = useQuery(() => fetchTopItems(from, to, 10), [from, to]);
  const hourly = useQuery(() => fetchHourly(from, to), [from, to]);
  const cashiers = useQuery(() => fetchCashiers(from, to), [from, to]);
  useLiveRefetch(['orders', 'payments'], () => Promise.all([sales.refetch(), top.refetch(), hourly.refetch(), cashiers.refetch()]), 1500);
  const s = sales.data;
  const days = s?.by_day.length ?? 1;

  const hours = useMemo(() => {
    const hs = (hourly.data ?? []).map((h) => h.hour);
    const min = Math.min(10, ...hs);
    const max = Math.max(23, ...hs);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [hourly.data]);
  const hourMap = useMemo(() => new Map((hourly.data ?? []).map((h) => [`${h.dow}-${h.hour}`, Number(h.total)])), [hourly.data]);

  // export spec
  const spec = useMemo<ExportSpec | null>(() => {
    if (!s) return null;
    return {
      title: t('reports.sales'),
      sections: [
        { heading: t('reports.sales'), kpis: [[t('reports.totalSales'), f.money(s.total)], [t('reports.ordersCount'), f.number(s.orders)], [t('reports.avgTicket'), f.money(s.avg_ticket)], [t('reports.discounts'), f.money(s.discounts)]] },
        { heading: t('reports.salesByDay'), table: { headers: [t('common.date'), t('reports.ordersShort'), t('common.total')], rows: s.by_day.map((d) => [f.date(d.date), f.number(d.orders), f.money(d.total)]) } },
        { heading: t('reports.topItems'), table: { headers: [t('inventory.item'), t('reports.sold'), t('reports.revenue')], rows: (top.data ?? []).map((i) => [i.name, f.number(i.qty), f.money(i.revenue)]) } },
        { heading: t('reports.cashiers'), table: { headers: [t('orders.cashier'), t('reports.ordersShort'), t('common.total'), t('reports.avgTicket'), t('reports.voids')], rows: (cashiers.data ?? []).map((c) => [c.name ?? '', f.number(c.orders), f.money(c.total), f.money(c.avg_ticket), f.number(c.voids)]) } },
      ],
      csv: { headers: [t('common.date'), t('reports.ordersShort'), t('common.total')], rows: s.by_day.map((d) => [d.date, d.orders, Number(d.total)]) },
    };
  }, [s, top.data, cashiers.data, t, f]);
  useEffect(() => register(spec), [register, spec]);

  if (sales.error && !s) return <ErrorState message={errorMessage(t, sales.error)} onRetry={() => void sales.refetch()} retryLabel={t('common.retry')} />;

  const cashierCols: Column<CashierRow>[] = [
    { key: 'n', header: t('orders.cashier'), cell: (c) => <span className="flex items-center gap-2"><Avatar name={c.name ?? '?'} url={c.avatar_url} size="sm" /><span>{c.name ?? t('common.unknown')}</span></span> },
    { key: 'o', header: t('reports.ordersShort'), cell: (c) => <span className="num">{f.number(c.orders)}</span> },
    { key: 't', header: t('common.total'), cell: (c) => <span className="num font-semibold">{f.money(Number(c.total))}</span> },
    { key: 'a', header: t('reports.avgTicket'), hideBelow: 'sm', cell: (c) => <span className="num">{f.money(Number(c.avg_ticket))}</span> },
    { key: 'd', header: t('reports.discounts'), hideBelow: 'md', cell: (c) => <span className="num">{f.money(Number(c.discounts))}</span> },
    { key: 'v', header: t('reports.voids'), align: 'end', cell: (c) => <span className={`num ${c.voids > 0 ? 'text-danger' : ''}`}>{f.number(c.voids)}</span> },
  ];
  const typeIcon = { dine_in: <Armchair className="size-4" />, takeaway: <ShoppingBag className="size-4" />, delivery: <Bike className="size-4" /> };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard emphasis label={t('reports.totalSales')} value={Number(s?.total ?? 0)} format={(n) => f.money(Math.round(n))} icon={<Wallet className="size-6" />} tone="green" loading={!s} trend={s ? percentChange(Number(s.total), Number(s.prev_total)) : null} trendLabel={t('common.vsPrevious')} />
        <StatCard label={t('reports.ordersCount')} value={Number(s?.orders ?? 0)} format={(n) => f.number(Math.round(n))} icon={<ShoppingBag className="size-6" />} tone="blue" loading={!s} delay={0.05} />
        <StatCard label={t('reports.avgTicket')} value={Number(s?.avg_ticket ?? 0)} format={f.money} icon={<Receipt className="size-6" />} tone="gold" loading={!s} delay={0.1} />
        <StatCard label={t('reports.discounts')} value={Number(s?.discounts ?? 0)} format={f.money} icon={<Percent className="size-6" />} tone="red" loading={!s} delay={0.15} />
      </div>
      <Card>
        <CardHeader title={t('reports.salesByDay')} icon={<TrendingUp className="size-5" />} />
        <div className="p-3">
          {s ? (
            <BarChart data={s.by_day.map((d) => ({ label: dayLabel(d.date, days), sublabel: `${f.date(d.date)} · ${f.number(d.orders)} ${t('reports.ordersShort')}`, value: Number(d.total) }))} format={f.money} formatAxis={(n) => f.number(Math.round(n), 0)} height={280} emptyLabel={t('common.noResults')} />
          ) : (
            <Skeleton className="h-72" />
          )}
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t('reports.byHour')} />
          <div className="p-4">
            {hourly.data ? (
              <Heatmap rows={[6, 0, 1, 2, 3, 4, 5]} cols={hours} value={(r, c) => hourMap.get(`${r}-${c}`) ?? 0} format={f.money} rowLabel={(r) => t(`day.${(r + 1) % 7}` as 'day.0')} colLabel={(c) => f.digits(c)} />
            ) : (
              <Skeleton className="h-56" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t('reports.byPayment')} />
          <div className="space-y-6 p-5">
            {s ? (
              <>
                <ShareBars
                  format={f.money}
                  items={s.by_payment.map((p) => ({
                    label: t(`payment.${p.method}`),
                    value: Number(p.amount),
                    icon: p.method === 'cash' ? <Banknote className="size-4" /> : <CreditCard className="size-4" />,
                    color: p.method === 'cash' ? '#7b7266' : '#b3aa9c',
                  }))}
                />
                <div>
                  <p className="mb-3 text-sm font-semibold text-fg-3">{t('reports.byType')}</p>
                  <ShareBars format={f.money} items={s.by_type.map((x) => ({ label: t(`order.type.${x.type}`), value: Number(x.total), icon: typeIcon[x.type] }))} />
                </div>
              </>
            ) : (
              <Skeleton className="h-48" />
            )}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('reports.topItems')} />
          <ul className="space-y-2 p-4">
            {(top.data ?? []).map((i, idx) => {
              const max = Number(top.data?.[0]?.qty ?? 1);
              return (
                <li key={i.menu_item_id ?? idx} className="flex items-center gap-3">
                  <span className="mono w-5 text-center text-sm text-fg-3">{f.digits(idx + 1)}</span>
                  <FoodImage src={i.image_url} alt="" className="size-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate text-fg">{name({ name_ar: i.name, name_he: i.name_he })}</span>
                      <span className="num text-fg">{f.money(Number(i.revenue))}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/5">
                        <div className={cn('h-full rounded-full', idx === 0 ? 'bg-brand' : 'bg-[#b3aa9c]')} style={{ width: `${(i.qty / max) * 100}%` }} />
                      </div>
                      <span className="num text-xs text-fg-3">{f.number(i.qty)} {t('reports.sold')}</span>
                    </div>
                  </div>
                </li>
              );
            })}
            {top.data && top.data.length === 0 && <EmptyState icon={<ShoppingBag className="size-7" />} title={t('common.noResults')} />}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title={t('reports.cashiers')} className="pb-3" />
          <DataTable columns={cashierCols} rows={cashiers.data ?? []} rowKey={(c) => c.cashier_id ?? 'none'} loading={!cashiers.data} empty={<EmptyState icon={<Users className="size-7" />} title={t('common.noResults')} />} />
        </Card>
      </div>
    </div>
  );
}

// ==================================================================== profit
export function ProfitTab({ from, to, register }: { from: string; to: string; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const dayLabel = useDayLabel();
  const profit = useQuery(() => fetchProfit(from, to), [from, to]);
  useLiveRefetch(['orders', 'expenses'], profit.refetch, 1500);
  const p = profit.data;
  const days = p?.by_day.length ?? 1;

  const spec = useMemo<ExportSpec | null>(() => {
    if (!p) return null;
    return {
      title: t('reports.profit'),
      sections: [
        { heading: t('reports.profit'), kpis: [[t('reports.revenue'), f.money(p.revenue)], [t('reports.cogs'), f.money(p.cogs)], [t('reports.expensesTotal'), f.money(p.expenses)], [t('reports.netProfit'), f.money(p.net)]] },
        { heading: t('reports.profitByDay'), table: { headers: [t('common.date'), t('reports.revenue'), t('reports.cogs'), t('reports.expensesTotal'), t('reports.netProfit')], rows: p.by_day.map((d) => [f.date(d.date), f.money(d.revenue), f.money(d.cogs), f.money(d.expenses), f.money(d.net)]) } },
        { heading: t('reports.expensesByCategory'), table: { headers: [t('menu.category'), t('common.amount')], rows: p.expenses_by_category.map((e) => [t(`expense.${e.category}`), f.money(e.amount)]) } },
      ],
      csv: {
        headers: [t('common.date'), t('reports.revenue'), t('reports.cogs'), t('reports.expensesTotal'), t('reports.netProfit')],
        rows: p.by_day.map((d) => [d.date, Number(d.revenue), Number(d.cogs), Number(d.expenses), Number(d.net)]),
      },
    };
  }, [p, t, f]);
  useEffect(() => register(spec), [register, spec]);

  if (profit.error && !p) return <ErrorState message={errorMessage(t, profit.error)} onRetry={() => void profit.refetch()} retryLabel={t('common.retry')} />;
  const margin = p && Number(p.revenue) > 0 ? (Number(p.net) / Number(p.revenue)) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('reports.revenue')} value={Number(p?.revenue ?? 0)} format={(n) => f.money(Math.round(n))} icon={<Wallet className="size-6" />} tone="green" loading={!p} />
        <StatCard label={t('reports.cogs')} value={Number(p?.cogs ?? 0)} format={(n) => f.money(Math.round(n))} icon={<ShoppingBag className="size-6" />} tone="blue" loading={!p} delay={0.05} />
        <StatCard label={t('reports.expensesTotal')} value={Number(p?.expenses ?? 0)} format={(n) => f.money(Math.round(n))} icon={<Receipt className="size-6" />} tone="red" loading={!p} delay={0.1} />
        <StatCard
          label={t('reports.netProfit')}
          emphasis
          value={Number(p?.net ?? 0)}
          format={(n) => f.money(Math.round(n))}
          icon={<Coins className="size-6" />}
          tone="gold"
          loading={!p}
          delay={0.15}
          trend={p ? percentChange(Number(p.net), Number(p.prev_net)) : null}
          trendLabel={t('common.vsPrevious')}
          footer={p ? <span className="ms-auto">{t('reports.margin')} {f.percent(margin)}</span> : undefined}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t('reports.profitByDay')} />
          <div className="p-3">
            {p ? <LineChart data={p.by_day.map((d) => ({ label: dayLabel(d.date, days), sublabel: f.date(d.date), value: Number(d.net) }))} format={f.money} formatAxis={(n) => f.number(Math.round(n), 0)} height={280} /> : <Skeleton className="h-72" />}
          </div>
        </Card>
        <Card>
          <CardHeader title={t('reports.expensesByCategory')} />
          <div className="p-5">
            {p ? (
              p.expenses_by_category.length ? (
                <ShareBars format={f.money} items={p.expenses_by_category.map((e) => ({ label: t(`expense.${e.category}`), value: Number(e.amount), color: '#b3aa9c' }))} />
              ) : (
                <EmptyState icon={<Receipt className="size-7" />} title={t('reports.expensesEmpty')} />
              )
            ) : (
              <Skeleton className="h-48" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ================================================================= employees
export function EmployeesReportTab({ from, to, register }: { from: string; to: string; register: RegisterExport }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const rep = useQuery(() => fetchEmployeeReport(from, to), [from, to]);
  useLiveRefetch(['attendance', 'work_shifts', 'employees_meta'], rep.refetch, 1500);
  const rows = useMemo(() => rep.data ?? [], [rep.data]);

  const spec = useMemo<ExportSpec | null>(
    () =>
      rep.data
        ? {
            title: t('reports.employees'),
            sections: [{ heading: t('reports.employees'), table: { headers: [t('common.name'), t('employees.position'), t('employees.hours'), t('employees.days'), t('employees.scheduled')], rows: rows.map((r) => [r.name, r.position, f.number(r.hours, 1), f.number(r.days), f.number(r.scheduled_shifts)]) } }],
            csv: { headers: [t('common.name'), t('employees.position'), t('employees.hours'), t('employees.days'), t('employees.scheduled')], rows: rows.map((r) => [r.name, r.position, Number(r.hours), r.days, r.scheduled_shifts]) },
          }
        : null,
    [rep.data, rows, t, f],
  );
  useEffect(() => register(spec), [register, spec]);

  const cols: Column<EmployeeReportRow>[] = [
    { key: 'n', header: t('common.name'), cell: (r) => <span className="flex items-center gap-2"><Avatar name={r.name} url={r.avatar_url} size="sm" /><span>{r.name}</span></span> },
    { key: 'p', header: t('employees.position'), hideBelow: 'sm', cell: (r) => r.position },
    { key: 'h', header: t('employees.hours'), cell: (r) => <span className="num font-semibold">{f.number(r.hours, 1)}</span> },
    { key: 'd', header: t('employees.days'), cell: (r) => <span className="num">{f.number(r.days)}</span> },
    { key: 's', header: t('employees.scheduled'), hideBelow: 'md', cell: (r) => <span className="num">{f.number(r.scheduled_shifts)}</span> },
    { key: 'c', header: t('employees.salaryAmount'), align: 'end', hideBelow: 'md', cell: (r) => <span className="num text-fg-2">{f.money(Number(r.salary_amount))} · {t(`employees.salary.${r.salary_type}`)}</span> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('employees.hours')} />
        <div className="p-3">{rep.data ? <BarChart highlight={null} data={rows.map((r) => ({ label: r.name.split(' ')[0], sublabel: r.name, value: Number(r.hours) }))} format={(n) => `${f.number(n, 1)} ${t('common.hoursShort')}`} height={240} /> : <Skeleton className="h-60" />}</div>
      </Card>
      <Card className="overflow-hidden">
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} loading={!rep.data} empty={<EmptyState icon={<Users className="size-7" />} title={t('common.noResults')} />} />
      </Card>
    </div>
  );
}
