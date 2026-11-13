import { useEffect, useState } from 'react';
import { Clock, LogIn, LogOut, Search, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useQuery } from '@/hooks/useQuery';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import { LiveClock } from '@/app/shell/TopBar';
import { fetchStaffBoard, type StaffMember } from '@/features/pos/api';

/** An open clock-in older than this is probably a forgotten clock-out. */
const FORGOT_HOURS = 14;

/**
 * Attendance kiosk: every staff member clocks in and out here. It is separate from staff management —
 * any signed-in device (the cashier's included) can open it, and it shows no pay or personal data.
 */
export default function AttendancePage() {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const board = useQuery(fetchStaffBoard, []);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      void board.refetch();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [board]);

  const clock = async (m: StaffMember, action: 'in' | 'out') => {
    setBusy(m.id);
    const { error } = await supabase.rpc('kiosk_clock', { p_employee_id: m.id, p_action: action });
    setBusy(null);
    if (error) return toast.error(errorMessage(t, error));
    toast.success(t(action === 'in' ? 'att.welcome' : 'att.bye', { name: m.full_name, time: f.time(new Date().toISOString()) }));
    void board.refetch();
  };

  const markAbsent = async (m: StaffMember) => {
    setBusy(m.id);
    const { error } = await supabase.rpc('kiosk_absent', { p_employee_id: m.id });
    setBusy(null);
    if (error) return toast.error(errorMessage(t, error));
    toast.info(t('att.absentSaved', { name: m.full_name }));
    void board.refetch();
  };

  const list = (board.data ?? []).filter((m) => !search.trim() || m.full_name.includes(search.trim()));
  const inCount = (board.data ?? []).filter((m) => m.open_since).length;

  return (
    <div>
      <PageHeader
        title={t('nav.attendance')}
        subtitle={t('att.kioskSub', { count: f.number(inCount) })}
        icon={<Clock className="size-6" />}
        actions={<LiveClock className="text-2xl text-fg" />}
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('att.searchStaff')}
          aria-label={t('att.searchStaff')}
          className="h-11 w-full rounded-btn border border-line-strong bg-card ps-9 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
        />
      </div>
      {board.error && !board.data ? (
        <ErrorState message={errorMessage(t, board.error)} onRetry={() => void board.refetch()} retryLabel={t('common.retry')} />
      ) : board.loading && !board.data ? (
        <SkeletonGrid count={8} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Clock className="size-6" />} title={t('att.noStaff')} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => {
            const since = m.open_since ? new Date(m.open_since).getTime() : null;
            const hours = since ? (now - since) / 3_600_000 : 0;
            const forgot = since !== null && hours >= FORGOT_HOURS;
            return (
              <Card key={m.id} className={cn('flex items-center gap-3 p-4', forgot && 'border-warning/50')}>
                <Avatar name={m.full_name} url={m.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fg">{m.full_name}</p>
                  {since ? (
                    <p className={cn('num text-xs', forgot ? 'text-warning' : 'text-success')}>
                      {forgot && <TriangleAlert className="me-1 inline size-3.5 align-[-2px]" />}
                      {forgot ? t('att.forgot', { time: f.dateTime(m.open_since!) }) : t('att.inSince', { time: f.time(m.open_since!), hours: f.number(hours, 1) })}
                    </p>
                  ) : m.absent_today ? (
                    <p className="text-xs text-danger">{t('att.absentToday')}</p>
                  ) : (
                    <p className="text-xs text-fg-3">{m.position || t('att.out_')}</p>
                  )}
                </div>
                {since ? (
                  <Button variant="secondary" icon={<LogOut className="size-4 rtl:-scale-x-100" />} loading={busy === m.id} onClick={() => void clock(m, 'out')}>
                    {t('att.clockOut')}
                  </Button>
                ) : (
                  <div className="flex gap-1.5">
                    {m.daily && !m.present_today && !m.absent_today && (
                      <Button variant="ghost" disabled={busy === m.id} onClick={() => void markAbsent(m)}>
                        {t('att.absent')}
                      </Button>
                    )}
                    <Button variant="primary" icon={<LogIn className="size-4 rtl:-scale-x-100" />} loading={busy === m.id} onClick={() => void clock(m, 'in')}>
                      {t('att.clockIn')}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
