import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { toISODate } from '@/lib/dates';
import { useToast } from '@/app/providers/ToastProvider';
import { PERMISSIONS, type Permission } from '@/app/providers/PermissionsProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Tabs';
import type { Profile, UserPermission } from '@/types/models';

type Grant = { on: boolean; mode: 'always' | 'until'; until: string };

/** The owner decides what a manager (or anyone) may see beyond their role — permanently or until a date. */
export function GrantsModal({ user, grants, onClose, onSaved }: {
  user: Profile | null;
  grants: UserPermission[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [state, setState] = useState<Record<Permission, Grant>>({} as Record<Permission, Grant>);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user) return;
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const next = {} as Record<Permission, Grant>;
    for (const p of PERMISSIONS) {
      const g = grants.find((x) => x.user_id === user.id && x.permission === p);
      const live = g && (!g.expires_at || new Date(g.expires_at) > new Date());
      next[p] = { on: Boolean(live), mode: g?.expires_at ? 'until' : 'always', until: g?.expires_at ? toISODate(new Date(g.expires_at)) : toISODate(week) };
    }
    setState(next);
  }, [user, grants]);

  const save = async () => {
    if (!user) return;
    setPending(true);
    try {
      const { error: d } = await supabase.from('user_permissions').delete().eq('user_id', user.id);
      if (d) throw d;
      const rows = PERMISSIONS.filter((p) => state[p]?.on).map((p) => ({
        user_id: user.id,
        permission: p,
        // "until" includes the whole chosen day
        expires_at: state[p].mode === 'until' ? new Date(`${state[p].until}T23:59:59`).toISOString() : null,
      }));
      if (rows.length) {
        const { error } = await supabase.from('user_permissions').insert(rows);
        if (error) throw error;
      }
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
      title={user ? t('perm.title', { name: user.full_name }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-fg-3">{t('perm.hint')}</p>
      <ul className="space-y-2">
        {PERMISSIONS.map((p) => {
          const g = state[p];
          if (!g) return null;
          const set = (patch: Partial<Grant>) => setState((s) => ({ ...s, [p]: { ...s[p], ...patch } }));
          return (
            <li key={p} className={cn('rounded-card border p-3 transition-colors', g.on ? 'border-line-strong bg-elevated' : 'border-line bg-card')}>
              <button type="button" aria-pressed={g.on} onClick={() => set({ on: !g.on })} className="flex w-full items-start gap-3 text-start">
                <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded border', g.on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
                  {g.on && <Check className="size-3.5" />}
                </span>
                <span>
                  <span className="block text-sm text-fg">{t(`perm.${p}`)}</span>
                  <span className="block text-xs text-fg-3">{t(`perm.${p}.hint`)}</span>
                </span>
              </button>
              {g.on && (
                <div className="mt-3 flex flex-wrap items-center gap-2 ps-8">
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
    </Modal>
  );
}
