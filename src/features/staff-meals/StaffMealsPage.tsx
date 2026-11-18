import { useMemo, useState } from 'react';
import { Download, Printer, Sandwich } from 'lucide-react';
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
import { Card, CardHeader } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
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
        <div className="space-y-4">
          <div className={showCost ? 'grid grid-cols-2 gap-3 md:grid-cols-3' : 'grid grid-cols-2 gap-3'}>
            <StatCard emphasis label={t('rep.meals')} value={meals.length} format={(n) => f.number(Math.round(n))} />
            <StatCard label={t('rep.mealValue')} value={total} format={f.money} />
            {showCost && <StatCard label={t('rep.mealCost')} value={cost} format={f.money} />}
          </div>

          {people.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title={t('meals.perEmployee')} />
              <ul className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setWho((w) => (w === e.name ? '' : e.name))}
                      className="w-full rounded-card border border-line bg-card p-3 text-start transition-colors hover:border-line-strong"
                    >
                      <p className="text-sm text-fg">{e.name}</p>
                      <p className="mt-1 flex justify-between text-xs text-fg-3">
                        <span>{t('meals.mealsCount', { count: f.number(e.meals) })}</span>
                        <span className="num text-sm text-fg">{f.money(Number(e.value))}</span>
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {days.length === 0 ? (
            <EmptyState icon={<Sandwich className="size-6" />} title={t('meals.none')} body={t('meals.noneHint')} />
          ) : (
            days.map(([day, list]) => (
              <Card key={day} className="overflow-hidden">
                <CardHeader
                  title={f.date(day)}
                  subtitle={t('meals.mealsCount', { count: f.number(list.length) })}
                  actions={<span className="num text-base text-fg">{f.money(list.reduce((a, m) => a + Number(m.value), 0))}</span>}
                />
                <ul className="divide-y divide-line">
                  {list.map((m) => (
                    <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="num w-14 shrink-0 pt-0.5 text-xs text-fg-3">{f.time(m.created_at)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg">{m.employee}</p>
                        <p className="text-xs text-fg-2">{m.items ?? '—'}</p>
                        {m.by && <p className="text-[0.6875rem] text-fg-3">{t('meals.by', { name: m.by })} · #{m.order_number}</p>}
                      </div>
                      <span className="num shrink-0 text-sm text-fg">{f.money(Number(m.value))}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
