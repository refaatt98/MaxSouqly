import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtime } from '@/hooks/useRealtime';
import type { AppRole } from '@/types/models';
import { useAuth } from './AuthProvider';

/**
 * Every screen / action an account can be allowed. Each role has defaults; the owner can switch any of them
 * on or off per account (on can be temporary). The owner always has all of them.
 */
export const PERMISSIONS = [
  'pos', 'orders', 'kitchen', 'menu', 'customers',
  'inventory', 'stocktake', 'stocktake_approve', 'receive_goods', 'costs',
  'attendance', 'advance', 'employees',
  'reports', 'activity',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Groups for the permissions screen. */
export const PERMISSION_GROUPS: { key: string; items: Permission[] }[] = [
  { key: 'sales', items: ['pos', 'orders', 'kitchen', 'menu', 'customers'] },
  { key: 'stock', items: ['inventory', 'stocktake', 'stocktake_approve', 'receive_goods', 'costs'] },
  { key: 'staff', items: ['attendance', 'advance', 'employees'] },
  { key: 'money', items: ['reports', 'activity'] },
];

/** Mirror of public.role_defaults() in the database. */
export const ROLE_DEFAULTS: Record<AppRole, Permission[]> = {
  owner: [...PERMISSIONS],
  manager: ['pos', 'kitchen', 'orders', 'menu', 'inventory', 'stocktake', 'receive_goods', 'attendance', 'advance'],
  cashier: ['pos', 'orders', 'stocktake', 'attendance', 'advance'],
  kitchen: ['kitchen', 'attendance'],
  inventory: ['inventory', 'stocktake', 'receive_goods', 'attendance'],
};

/**
 * Mirror of public.perm_locked(): rules from the spec the owner cannot override —
 * purchase costs are the owner's only; financial reports go to a manager at most; the cashier never sees pay.
 */
export function permLocked(role: AppRole, p: Permission): boolean {
  if (role === 'owner') return false;
  if (p === 'costs') return true;
  if ((p === 'reports' || p === 'activity') && role !== 'manager') return true;
  return p === 'employees' && role === 'cashier';
}

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

/** Where each account lands after signing in: its role's main screen, else the first screen it may open. */
export function homeFor(role: AppRole, can: (p: Permission) => boolean): string {
  const preferred: Record<AppRole, Permission> = { owner: 'reports', manager: 'reports', cashier: 'pos', kitchen: 'kitchen', inventory: 'inventory' };
  const paths: [Permission, string][] = [['reports', '/'], ['pos', '/pos'], ['kitchen', '/kitchen'], ['orders', '/orders'], ['inventory', '/inventory'], ['stocktake', '/inventory'], ['menu', '/menu'], ['attendance', '/attendance']];
  if (can(preferred[role])) return paths.find(([p]) => p === preferred[role])![1];
  return paths.find(([p]) => can(p))?.[1] ?? '/settings';
}
