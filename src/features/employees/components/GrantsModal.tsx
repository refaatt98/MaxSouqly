import { useEffect, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { toISODate } from '@/lib/dates';
import { useToast } from '@/app/providers/ToastProvider';
import { PERMISSION_GROUPS, PERMISSIONS, ROLE_DEFAULTS, permLocked, type Permission } from '@/app/providers/PermissionsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Tabs';
import type { AppRole, Profile, UserPermission } from '@/types/models';

export type GrantState = Record<Permission, { on: boolean; mode: 'always' | 'until'; until: string }>;

const weekAhead = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return toISODate(d);
};

/** What a person can see right now: their role's defaults, adjusted by the owner's on/off choices. */
export function initialGrants(role: AppRole, rows: UserPermission[] = []): GrantState {
  const out = {} as GrantState;
  for (const p of PERMISSIONS) {
    const row = rows.find((r) => r.permission === p);
    const live = row && (row.effect === 'deny' || !row.expires_at || new Date(row.expires_at) > new Date());
    const on = permLocked(role, p) ? false : live ? row.effect === 'grant' : ROLE_DEFAULTS[role].includes(p);
    out[p] = { on, mode: row?.expires_at ? 'until' : 'always', until: row?.expires_at ? toISODate(new Date(row.expires_at)) : weekAhead() };
  }
  return out;
}

/** Only the differences from the role's defaults are stored. */
export async function saveGrants(userId: string, role: AppRole, state: GrantState): Promise<void> {
  const { error: d } = await supabase.from('user_permissions').delete().eq('user_id', userId);
  if (d) throw d;
  if (role === 'owner') return;
  const rows = PERMISSIONS.flatMap((p) => {
    const def = ROLE_DEFAULTS[role].includes(p);
    const g = state[p];
    if (permLocked(role, p)) return [];
    if (g.on && !def) {
      return [{ user_id: userId, permission: p, effect: 'grant', expires_at: g.mode === 'until' ? new Date(`${g.until}T23:59:59`).toISOString() : null }];
    }
    if (!g.on && def) return [{ user_id: userId, permission: p, effect: 'deny', expires_at: null }];
    return [];
  });
  if (rows.length) {
    const { error } = await supabase.from('user_permissions').insert(rows);
    if (error) throw error;
  }
}

/** The list of switches, grouped (selling, stock, staff, money). */
export function PermissionChecklist({ role, value, onChange }: { role: AppRole; value: GrantState; onChange: (v: GrantState) => void }) {
  const t = useT();
  if (role === 'owner') return <p className="rounded-card border border-line bg-card p-4 text-sm text-fg-2">{t('perm.ownerAll')}</p>;
  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.key}>
          <h3 className="mb-2 text-xs text-fg-3">{t(`perm.group.${group.key as 'sales'}`)}</h3>
          <ul className="space-y-1.5">
            {group.items.map((p) => {
              const g = value[p];
              if (!g) return null;
              const def = ROLE_DEFAULTS[role].includes(p);
              if (permLocked(role, p)) {
                return (
                  <li key={p} className="flex items-start gap-3 rounded-card border border-dashed border-line px-3 py-2.5 opacity-70">
                    <Lock className="mt-0.5 size-4 shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-fg-2">{t(`perm.${p}`)}</span>
                      <span className="block text-xs text-fg-3">{t(p === 'costs' ? 'perm.lockedCosts' : p === 'employees' ? 'perm.lockedPay' : 'perm.lockedReports')}</span>
                    </span>
                  </li>
                );
              }
              const changed = g.on !== def;
              const set = (patch: Partial<GrantState[Permission]>) => onChange({ ...value, [p]: { ...g, ...patch } });
              return (
                <li key={p} className={cn('rounded-card border px-3 py-2.5 transition-colors', g.on ? 'border-line-strong bg-elevated' : 'border-line bg-card')}>
                  <button type="button" aria-pressed={g.on} onClick={() => set({ on: !g.on })} className="flex w-full items-start gap-3 text-start">
                    <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded border', g.on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
                      {g.on && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm text-fg">
                        {t(`perm.${p}`)}
                        {changed && <span className="rounded bg-warning/15 px-1.5 text-[0.6875rem] text-warning">{t('perm.custom')}</span>}
                      </span>
                      <span className="block text-xs text-fg-3">{t(`perm.${p}.hint`)}</span>
                    </span>
                  </button>
                  {g.on && !def && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 ps-8">
                      <Segmented
                        size="sm"
                        layoutId={`perm-${p}`}
                        value={g.mode}
                        onChange={(m) => set({ mode: m })}
                        items={[{ key: 'always', label: t('perm.always') }, { key: 'until', label: t('perm.until') }]}
                      />
                      {g.mode === 'until' && (
                        <input
                          type="date"
                          value={g.until}
                          min={toISODate(new Date())}
                          onChange={(e) => e.target.value && set({ until: e.target.value })}
                          aria-label={t('perm.until')}
                          className="h-9 rounded-btn border border-line-strong bg-surface px-2 text-sm focus:border-fg-3 focus:outline-none"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Edit what an existing account can see and do. */
export function GrantsModal({ user, grants, onClose, onSaved }: {
  user: Profile | null;
  grants: UserPermission[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [state, setState] = useState<GrantState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (user) setState(initialGrants(user.role, grants.filter((g) => g.user_id === user.id)));
  }, [user, grants]);

  const save = async () => {
    if (!user || !state) return;
    setPending(true);
    try {
      await saveGrants(user.id, user.role, state);
      toast.success(t('common.saved'));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      size="lg"
      title={user ? t('perm.title', { name: user.full_name }) : ''}
      description={user ? t('perm.roleHint', { role: t(`role.${user.role}`) }) : undefined}
      footer={
        <>
          {user && user.role !== 'owner' && (
            <Button variant="ghost" className="me-auto" onClick={() => setState(initialGrants(user.role))}>
              {t('perm.reset')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      {user && state && <PermissionChecklist role={user.role} value={state} onChange={setState} />}
    </Modal>
  );
}
