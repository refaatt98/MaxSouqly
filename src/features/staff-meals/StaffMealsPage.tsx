import { useMemo, useState } from 'react';
import { Download, Printer, Sandwich } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { downloadCsv } from '@/lib/csv';
import { printA4Report } from '@/lib/print';
import { presetRange, toISODate } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { fromJson } from '@/types/models';

interface MealsRep {
  employees: { id: string; name: string; meals: number; items: number; value: number; cost?: number | null }[];
  meals: { id: string; order_number: number; created_at: string; employee: string; by: string | null; items: string | null; value: number }[];
}

type Preset = 'today' | '7d' | '30d' | 'custom';

/** What each employee ate, day by day. Staff meals are not sales: they never touch the cash drawer. */
export default function StaffMealsPage() {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const [preset, setPreset] = useState<Preset>('7d');
  const [custom, setCustom] = useState(() => presetRange('7d'));
  const range = preset === 'custom' ? custom : presetRange(preset);
  const [who, setWho] = useState('');

  const rep = useQuery(async () => {
    const { data, error } = await supabase.rpc('report_staff_meals', { p_from: range.from, p_to: range.to });
    if (error) throw error;
    return fromJson<MealsRep>(data);
  }, [range.from, range.to]);
  useLiveRefetch(['orders', 'order_items'], rep.refetch, 1500);

  const d = rep.data;
  const showCost = (d?.employees ?? []).some((e) => e.cost !== null && e.cost !== undefined);
  const meals = useMemo(() => (d?.meals ?? []).filter((m) => !who || m.employee === who), [d, who]);
  const people = useMemo(() => (d?.employees ?? []).filter((e) => !who || e.name === who), [d, who]);
  const days = useMemo(() => {
    const map = new Map<string, MealsRep['meals']>();
    for (const m of meals) {
      const k = toISODate(new Date(m.created_at));
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [meals]);
  const total = meals.reduce((a, m) => a + Number(m.value), 0);
  const cost = people.reduce((a, e) => a + Number(e.cost ?? 0), 0);
  const allValue = (d?.employees ?? []).reduce((a, e) => a + Number(e.value), 0);

  const period = t('reports.period', { from: f.date(range.from), to: f.date(range.to) });
  const exportCsv = () =>
    downloadCsv(
      `max-staff-meals-${range.from}_${range.to}`,
      [t('common.date'), t('employees.shiftEmployee'), t('rep.mealItems'), t('rep.mealValue'), t('rep.by')],
      meals.map((m) => [new Date(m.created_at).toLocaleString('en-GB'), m.employee, m.items ?? '', Number(m.value), m.by ?? '']),
    );
  const print = () =>
    void printA4Report(
      t('rep.staffMeals'),
      [period, t('reports.generatedAt', { date: f.dateTime(new Date()) })],
      [
        {
          heading: t('rep.staffMeals'),
          kpis: [
            [t('rep.meals'), f.number(meals.length)],
            [t('rep.mealValue'), f.money(total)],
            ...(showCost ? ([[t('rep.mealCost'), f.money(cost)]] as [string, string][]) : []),
          ],
          table: {
            headers: [t('common.name'), t('rep.meals'), t('rep.mealItems'), t('rep.mealValue'), ...(showCost ? [t('rep.mealCost')] : [])],
            rows: people.map((e) => [e.name, f.number(e.meals), f.number(e.items), f.money(Number(e.value)), ...(showCost ? [f.money(Number(e.cost))] : [])]),
          },
        },
        ...days.map(([day, list]) => ({
          heading: `${f.date(day)} — ${f.money(list.reduce((a, m) => a + Number(m.value), 0))}`,
          table: {
            headers: [t('common.time'), t('employees.shiftEmployee'), t('rep.mealItems'), t('rep.mealValue')],
            rows: list.map((m) => [f.time(m.created_at), m.employee, m.items ?? '', f.money(Number(m.value))]),
          },
        })),
      ],
      { settings },
      lang,
    );

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader
        title={t('rep.staffMeals')}
        subtitle={t('rep.staffMealsHint')}
        actions={
          <>
            <Button icon={<Printer className="size-4" />} onClick={print} disabled={!d}>{t('reports.printReport')}</Button>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!d}>{t('common.export')}</Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Segmented
          layoutId="meals-range"
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
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label={t('common.from')} value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-10 rounded-btn border border-line-strong bg-surface px-2 text-sm" />
            <span className="text-fg-3">—</span>
            <input type="date" aria-label={t('common.to')} value={custom.to} min={custom.from} max={toISODate(new Date())} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-10 rounded-btn border border-line-strong bg-surface px-2 text-sm" />
          </div>
        )}
        <Select
          className="min-w-48"
          aria-label={t('employees.shiftEmployee')}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          options={[{ value: '', label: t('meals.allStaff') }, ...(d?.employees ?? []).map((e) => ({ value: e.name, label: e.name }))]}
        />
        <p className="ms-auto text-sm text-fg-3">{period}</p>
      </Card>

      {rep.error && !d ? (
        <ErrorState message={errorMessage(t, rep.error)} onRetry={() => void rep.refetch()} retryLabel={t('common.retry')} />
      ) : !d ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-5">
          <div className={showCost ? 'grid grid-cols-2 gap-3 md:grid-cols-4' : 'grid grid-cols-2 gap-3 md:grid-cols-3'}>
            <StatCard emphasis label={t('rep.meals')} value={meals.length} format={(n) => f.number(Math.round(n))} />
            <StatCard label={t('rep.mealValue')} value={total} format={f.money} />
            {showCost && <StatCard label={t('rep.mealCost')} value={cost} format={f.money} />}
            <StatCard label={t('meals.avg')} value={meals.length ? total / meals.length : 0} format={f.money} />
          </div>

          {(d.employees ?? []).length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[0.9375rem] font-medium text-fg">{t('meals.perEmployee')}</h2>
                {who && (
                  <button type="button" onClick={() => setWho('')} className="text-xs text-fg-3 hover:text-fg">
                    {t('meals.showAll')}
                  </button>
                )}
              </div>
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {d.employees.map((e) => {
                  const share = allValue > 0 ? (Number(e.value) / allValue) * 100 : 0;
                  const on = who === e.name;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setWho((w) => (w === e.name ? '' : e.name))}
                        className={cn(
                          'w-full rounded-card border p-3.5 text-start transition-colors',
                          on ? 'border-brand/60 bg-brand/[0.08]' : who ? 'border-line bg-card opacity-60 hover:opacity-100' : 'border-line bg-card hover:border-line-strong',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={e.name} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-fg">{e.name}</p>
                            <p className="text-xs text-fg-3">
                              {t('meals.mealsCount', { count: f.number(e.meals) })} · {t('meals.itemsCount', { count: f.number(e.items) })}
                            </p>
                          </div>
                          <p className="num text-base text-fg">{f.money(Number(e.value))}</p>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-fg/[0.06]">
                          <div className={cn('h-full rounded-full', on ? 'bg-brand' : 'bg-fg/30')} style={{ width: `${Math.max(share, 2)}%` }} />
                        </div>
                        <p className="num mt-1 text-[0.6875rem] text-fg-3">{t('meals.share', { pct: f.number(share, 0) })}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {days.length === 0 ? (
            <EmptyState icon={<Sandwich className="size-6" />} title={t('meals.none')} body={t('meals.noneHint')} />
          ) : (
            <section className="space-y-4">
              <h2 className="text-[0.9375rem] font-medium text-fg">{t('meals.byDay')}</h2>
              {days.map(([day, list]) => {
                const dayTotal = list.reduce((a, m) => a + Number(m.value), 0);
                return (
                  <div key={day} className="overflow-hidden rounded-card border border-line bg-card">
                    <div className="flex items-center justify-between gap-3 border-b border-line bg-fg/[0.02] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-btn bg-elevated text-center leading-none">
                          <span className="num text-base font-medium text-fg">{new Date(`${day}T12:00:00`).getDate()}</span>
                        </span>
                        <div>
                          <p className="text-sm font-medium text-fg">{f.weekdayDate(`${day}T12:00:00`)}</p>
                          <p className="text-xs text-fg-3">{t('meals.mealsCount', { count: f.number(list.length) })}</p>
                        </div>
                      </div>
                      <p className="num text-lg text-fg">{f.money(dayTotal)}</p>
                    </div>
                    <ul className="divide-y divide-line">
                      {list.map((m) => (
                        <li key={m.id} className="flex items-start gap-3 px-4 py-3.5">
                          <Avatar name={m.employee} size="sm" className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="text-sm font-medium text-fg">{m.employee}</p>
                              <span className="num rounded-full bg-fg/[0.06] px-2 py-0.5 text-[0.6875rem] text-fg-2">{f.time(m.created_at)}</span>
                              <span className="num text-[0.6875rem] text-fg-3">#{m.order_number}</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(m.items ?? '').split('، ').filter(Boolean).map((it, i) => (
                                <span key={i} className="rounded-btn border border-line bg-surface px-2 py-0.5 text-xs text-fg-2">{it}</span>
                              ))}
                            </div>
                            {m.by && <p className="mt-1.5 text-[0.6875rem] text-fg-3">{t('meals.by', { name: m.by })}</p>}
                          </div>
                          <span className="num shrink-0 text-sm font-medium text-fg">{f.money(Number(m.value))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
