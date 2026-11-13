import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtime } from '@/hooks/useRealtime';
import type { AppRole } from '@/types/models';
import { useAuth } from './AuthProvider';

/** What the owner can grant to other accounts (permanently or until a date). The owner always has all of them. */
export const PERMISSIONS = ['reports', 'employees', 'customers', 'costs', 'activity', 'stocktake_approve'] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CACHE = 'max.perms';

interface PermissionsValue {
  ready: boolean;
  can: (p: Permission) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PermissionsValue | null>(null);

function readCache(userId: string): Permission[] | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id: string; perms: Permission[] };
    return v.id === userId ? v.perms : null;
  } catch {
    return null;
  }
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { profile, role } = useAuth();
  const userId = profile?.id ?? null;
  const [perms, setPerms] = useState<{ id: string; set: Set<Permission> } | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc('my_permissions');
    if (error) {
      // offline: keep what we knew
      const cached = readCache(userId);
      if (cached) setPerms({ id: userId, set: new Set(cached) });
      return;
    }
    const list = ((data ?? []) as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    setPerms({ id: userId, set: new Set(list) });
    try {
      localStorage.setItem(CACHE, JSON.stringify({ id: userId, perms: list }));
    } catch {
      /* ignore */
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    // temporary grants expire on their own: re-check every minute
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh, role]);

  useRealtime(userId ? { table: 'user_permissions' } : null, () => void refresh());

  const value = useMemo<PermissionsValue>(() => {
    const set = perms && perms.id === userId ? perms.set : null;
    return {
      ready: role === 'owner' || set !== null,
      can: (p) => role === 'owner' || Boolean(set?.has(p)),
      refresh,
    };
  }, [perms, userId, role, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions(): PermissionsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider');
  return ctx;
}

/** Where each account lands after signing in. A manager without report access starts at the orders list. */
export function homeFor(role: AppRole, can: (p: Permission) => boolean): string {
  if (role === 'manager' && !can('reports')) return '/orders';
  return { owner: '/', manager: '/', cashier: '/pos', kitchen: '/kitchen', inventory: '/inventory' }[role];
}
