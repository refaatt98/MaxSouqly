import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { fetchOpenShift, SHIFT_EVENT } from '@/features/pos/api';
import { OpenShiftPanel } from '@/features/pos/components/ShiftPanels';
import { Skeleton } from '@/components/ui/Skeleton';
import type { CashShift } from '@/types/models';

const SHIFT_CACHE = 'max.pos.shift';

/** A cashier can't use anything until their cash shift is open. Re-locks when the shift is closed. */
export function CashierShiftGate({ children }: { children: ReactNode }) {
  const { role, profile } = useAuth();
  const [shift, setShift] = useState<CashShift | null | undefined>(undefined);
  const isCashier = role === 'cashier';

  useEffect(() => {
    if (!isCashier || !profile) return;
    let cancelled = false;
    const load = () =>
      fetchOpenShift(profile.id)
        .then((s) => {
          if (cancelled) return;
          setShift(s);
          try {
            if (s) localStorage.setItem(SHIFT_CACHE, JSON.stringify(s));
            else localStorage.removeItem(SHIFT_CACHE);
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          // offline: trust the last known shift
          if (cancelled) return;
          try {
            const cached = localStorage.getItem(SHIFT_CACHE);
            setShift(cached ? (JSON.parse(cached) as CashShift) : null);
          } catch {
            setShift(null);
          }
        });
    void load();
    const onChange = () => void load();
    window.addEventListener(SHIFT_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_EVENT, onChange);
    };
  }, [isCashier, profile]);

  if (!isCashier) return <>{children}</>;
  if (shift === undefined) return <Skeleton className="m-6 h-64" />;
  if (shift === null) return <OpenShiftPanel onOpened={setShift} />;
  return <>{children}</>;
}
