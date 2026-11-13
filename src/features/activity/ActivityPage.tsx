import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Printer, ScrollText, Search, Trash, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isTranslationKey, useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { printZReport } from '@/lib/print';
import { presetRange, rangeToTimestamps } from '@/lib/dates';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useDeleteRecord } from '@/app/providers/DeleteProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Tabs, Segmented } from '@/components/ui/Tabs';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { DataTable, type Column } from '@/components/ui/Table';
import { ZReportView } from '@/features/pos/components/ShiftPanels';
import { fromJson, type CashShift, type ShiftReport } from '@/types/models';
import type { Json } from '@/types/database';

type Tab = 'log' | 'shifts';
type Kind = 'all' | 'sales' | 'edits' | 'deletes';

interface LogRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  user: { full_name: string; avatar_url: string | null } | null;
}

const DELETE_ACTIONS = ['delete', 'void_order', 'refund_order', 'void_order_item', 'cancel_cart'];

function LogTab() {
  const { t } = useI18n();
  const { f } = useSettings();
  const [preset, setPreset] = useState<'today' | '7d' | '30d'>('today');
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  const range = presetRange(preset);
  const log = useQuery(async (): Promise<LogRow[]> => {
    const { start, end } = rangeToTimestamps(range.from, range.to);
    let q = supabase
      .from('audit_log')
      .select('id, action, entity, entity_id, details, created_at, user:profiles!audit_log_user_id_fkey(full_name, avatar_url)')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(500);
    if (kind === 'sales') q = q.eq('action', 'sale');
    else if (kind === 'deletes') q = q.in('action', DELETE_ACTIONS);
    else if (kind === 'edits') q = q.not('action', 'in', `(sale,${DELETE_ACTIONS.join(',')})`);
    const { data, error } = await q;
    if (error) throw error;
    return data as unknown as LogRow[];
  }, [range.from, range.to, kind]);
  useLiveRefetch(['orders', 'menu_items', 'ingredients', 'expenses', 'purchase_orders', 'employees_meta', 'attendance', 'payroll'], log.refetch, 1500);

  const label = (prefix: string, key: string) => {
    const k = `${prefix}.${key}`;
    return isTranslationKey(k) ? t(k) : key;
  };
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
    if (typeof v === 'number') return f.number(v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return f.dateTime(v);
    if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return '…';
    return typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v);
  };

  const summary = (r: LogRow): { title: string; lines: string[] } => {
    const d = r.details ?? {};
    const lines: string[] = [];
    let title = '';
    if (typeof d.order_number === 'number' || typeof d.order_number === 'string') title = `#${f.digits(String(d.order_number))}`;
    if (typeof d.label === 'string' && d.label) title = d.label;
    if (typeof d.email === 'string') title = d.email;
    if (r.action === 'sale' && d.total !== undefined) lines.push(f.money(Number(d.total)));
    if (typeof d.customer_phone === 'string' && d.customer_phone) lines.push(d.customer_phone);
    if (typeof d.item === 'string') lines.push(`${d.quantity ?? ''}× ${d.item}`);
    if (typeof d.from === 'string' && typeof d.to === 'string') lines.push(`${d.from} ← ${d.to}`);
    if (typeof d.reason === 'string' && d.reason) lines.push(d.reason);
    if (typeof d.delta === 'number' && Math.abs(d.delta) >= 0.01) lines.push(d.delta < 0 ? t('edit.refund', { amount: f.money(Math.abs(d.delta)) }) : t('edit.collect', { amount: f.money(d.delta) }));
    if (d.expected !== undefined && d.counted !== undefined) lines.push(`${t('shift.expectedCash')} ${f.money(Number(d.expected))} · ${t('shift.countedCash')} ${f.money(Number(d.counted))}`);
    const changes = d.changes as Record<string, { from: unknown; to: unknown }> | undefined;
    if (changes && r.action === 'update') {
      for (const [k, c] of Object.entries(changes).slice(0, 4)) lines.push(`${label('act.field', k)}: ${show(c.from)} ← ${show(c.to)}`);
    }
    return { title, lines };
  };

  const rows = (log.data ?? []).filter((r) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return JSON.stringify(r.details).toLowerCase().includes(s) || (r.user?.full_name ?? '').toLowerCase().includes(s);
  });

  const tone = (a: string) => (a === 'sale' ? 'green' : DELETE_ACTIONS.includes(a) ? 'red' : a === 'insert' ? 'neutral' : 'amber');

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('act.search')}
            aria-label={t('act.search')}
            className="h-11 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
          />
        </div>
        <Segmented layoutId="act-kind" value={kind} onChange={setKind} items={(['all', 'sales', 'edits', 'deletes'] as Kind[]).map((k) => ({ key: k, label: t(`act.filter.${k}`) }))} />
        <Segmented layoutId="act-range" value={preset} onChange={setPreset} items={[{ key: 'today', label: t('reports.range.today') }, { key: '7d', label: t('reports.range.7d') }, { key: '30d', label: t('reports.range.30d') }]} />
      </Card>
      <Card className="overflow-hidden">
        {log.error && !log.data ? (
          <ErrorState message={errorMessage(t, log.error)} onRetry={() => void log.refetch()} retryLabel={t('common.retry')} />
        ) : log.loading && !log.data ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-6" />} title={t('act.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const s = summary(r);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <Avatar name={r.user?.full_name ?? t('act.system')} url={r.user?.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(r.action)}>{label('act.action', r.action)}</Badge>
                      <span className="text-sm text-fg-2">{label('act.entity', r.entity)}</span>
                      {s.title && <span className="truncate text-sm text-fg">{s.title}</span>}
                    </div>
                    {s.lines.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[0.8125rem] text-fg-2">
                        {s.lines.map((l, i) => (
                          <li key={i} className="num">{l}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="shrink-0 text-end text-xs text-fg-3">
                    <p className="num">{f.dateTime(r.created_at)}</p>
                    <p>{r.user?.full_name ?? t('act.system')}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

type ShiftRow = CashShift & { cashier: { full_name: string } | null };

function ShiftsTab() {
  const { t, lang } = useI18n();
  const { f, settings } = useSettings();
  const removeRecord = useDeleteRecord();
  const [report, setReport] = useState<ShiftReport | null>(null);
  const shifts = useQuery(async (): Promise<ShiftRow[]> => {
    const { data, error } = await supabase
      .from('cash_shifts')
      .select('*, cashier:profiles!cash_shifts_cashier_id_fkey(full_name)')
      .order('opened_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data as unknown as ShiftRow[];
  }, []);
  useLiveRefetch(['cash_shifts'], shifts.refetch);

  const open = async (s: ShiftRow) => {
    const { data, error } = await supabase.rpc('shift_report', { p_shift_id: s.id });
    if (!error) setReport(fromJson<ShiftReport>(data as Json));
  };

  const columns = useMemo<Column<ShiftRow>[]>(
    () => [
      { key: 'c', header: t('orders.cashier'), cell: (s) => <span className="text-fg">{s.cashier?.full_name ?? t('common.unknown')}</span> },
      { key: 'o', header: t('common.from'), cell: (s) => <span className="num text-fg-2">{f.dateTime(s.opened_at)}</span> },
      {
        key: 'cl',
        header: t('common.to'),
        cell: (s) => (s.closed_at ? <span className="num text-fg-2">{f.dateTime(s.closed_at)}</span> : <Badge tone="green" dot>{t('act.open')}</Badge>),
      },
      { key: 'f', header: t('shift.openingFloat'), hideBelow: 'md', cell: (s) => <span className="num">{f.money(Number(s.opening_float))}</span> },
      { key: 'e', header: t('shift.expectedCash'), hideBelow: 'sm', cell: (s) => <span className="num">{s.expected_cash !== null ? f.money(Number(s.expected_cash)) : '—'}</span> },
      { key: 'n', header: t('shift.countedCash'), hideBelow: 'sm', cell: (s) => <span className="num">{s.counted_cash !== null ? f.money(Number(s.counted_cash)) : '—'}</span> },
      {
        key: 'v',
        header: t('shift.variance'),
        cell: (s) => {
          if (s.counted_cash === null || s.expected_cash === null) return '—';
          const v = Number(s.counted_cash) - Number(s.expected_cash);
          return <span className={cn('num', Math.abs(v) >= 0.01 ? 'text-danger' : 'text-success')}>{f.money(v)}</span>;
        },
      },
      {
        key: 'x',
        header: '',
        align: 'end',
        cell: (s) => (
          <IconButton
            label={t('del.button')}
            size="sm"
            className="hover:text-danger"
            onClick={(e) => {
              e.stopPropagation();
              void removeRecord('cash_shift', s.id, s.cashier?.full_name ?? '').then((ok) => ok && void shifts.refetch());
            }}
          >
            <Trash className="size-4" />
          </IconButton>
        ),
      },
    ],
    [t, f, removeRecord, shifts],
  );

  return (
    <Card className="overflow-hidden">
      <DataTable
        columns={columns}
        rows={shifts.data ?? []}
        rowKey={(s) => s.id}
        loading={shifts.loading && !shifts.data}
        onRowClick={(s) => void open(s)}
        empty={<EmptyState icon={<Wallet className="size-6" />} title={t('act.shiftEmpty')} />}
      />
      <Modal
        open={report !== null}
        onClose={() => setReport(null)}
        title={t('shift.zReport')}
        footer={
          report && (
            <Button icon={<Printer className="size-4" />} onClick={() => void printZReport(report, { t, f, settings }, lang)}>
              {t('shift.printZ')}
            </Button>
          )
        }
      >
        {report && <ZReportView report={report} />}
      </Modal>
    </Card>
  );
}

export default function ActivityPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'shifts' ? 'shifts' : 'log';
  return (
    <div>
      <PageHeader title={t('act.title')} />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(k) => {
          params.set('tab', k);
          setParams(params, { replace: true });
        }}
        items={[
          { key: 'log', label: t('act.log'), icon: <ScrollText className="size-4" /> },
          { key: 'shifts', label: t('act.shifts'), icon: <Wallet className="size-4" /> },
        ]}
      />
      {tab === 'log' ? <LogTab /> : <ShiftsTab />}
    </div>
  );
}
