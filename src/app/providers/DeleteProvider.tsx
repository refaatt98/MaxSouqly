import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Info, Trash } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { isTranslationKey, useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import type { UnitType } from '@/types/models';
import { useSettings } from './SettingsProvider';
import { useToast } from './ToastProvider';

export type DeletableEntity =
  | 'order' | 'purchase_order' | 'stock_count' | 'stock_movement' | 'expense' | 'payroll'
  | 'menu_item' | 'category' | 'ingredient' | 'supplier' | 'employee' | 'attendance' | 'work_shift' | 'cash_shift';

type Effect =
  | { t: 'stock'; name: string; unit: UnitType; change: number }
  | { t: 'cost'; name: string; from: number; to: number }
  | { t: 'money'; what: 'sales' | 'expenses'; amount: number }
  | { t: 'rows'; what: string; count: number }
  | { t: 'note'; what: string };

interface Pending {
  entity: DeletableEntity;
  id: string;
  name: string;
  effects: Effect[] | null;
  resolve: (deleted: boolean) => void;
}

type DeleteFn = (entity: DeletableEntity, id: string, name: string) => Promise<boolean>;

const DeleteContext = createContext<DeleteFn | null>(null);

async function run(entity: DeletableEntity, id: string, dryRun: boolean): Promise<Effect[]> {
  const { data, error } = await supabase.rpc('delete_record', { p_entity: entity, p_id: id, p_dry_run: dryRun });
  if (error) throw error;
  return (data ?? []) as unknown as Effect[];
}

/**
 * Delete anything with full rollback. Shows exactly what will be returned/changed before confirming.
 * Usage: `const remove = useDeleteRecord(); if (await remove('order', id, '#1001')) refetch();`
 */
export function DeleteProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<Pending | null>(null);

  const remove = useCallback<DeleteFn>(
    (entity, id, name) =>
      new Promise<boolean>((resolve) => {
        const p: Pending = { entity, id, name, effects: null, resolve };
        current.current = p;
        setPending(p);
        run(entity, id, true)
          .then((effects) => {
            if (current.current === p) setPending({ ...p, effects });
          })
          .catch((err) => {
            toast.error(errorMessage(t, err));
            current.current = null;
            setPending(null);
            resolve(false);
          });
      }),
    [t, toast],
  );

  const close = (deleted: boolean) => {
    pending?.resolve(deleted);
    current.current = null;
    setPending(null);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await run(pending.entity, pending.id, false);
      toast.success(t('del.done'));
      close(true);
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const fx = pending?.effects ?? [];
  const stock = fx.filter((e): e is Extract<Effect, { t: 'stock' }> => e.t === 'stock');
  const others = fx.filter((e) => e.t !== 'stock');

  const line = (e: Effect): string => {
    switch (e.t) {
      case 'cost':
        return t('del.costLine', { name: e.name, from: f.money(Number(e.from)), to: f.money(Number(e.to)) });
      case 'money':
        return t(e.what === 'sales' ? 'del.sales' : 'del.expenses', { amount: f.money(Math.abs(Number(e.amount))) });
      case 'rows': {
        const key = `del.what.${e.what}`;
        return t('del.rows', { count: f.number(e.count), what: isTranslationKey(key) ? t(key) : e.what });
      }
      case 'note': {
        const key = `del.note.${e.what}`;
        return isTranslationKey(key) ? t(key) : e.what;
      }
      default:
        return '';
    }
  };

  return (
    <DeleteContext.Provider value={remove}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => !busy && close(false)}
        size="md"
        title={pending ? t('del.title', { name: pending.name }) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" icon={<Trash className="size-4" />} loading={busy} disabled={!pending?.effects} onClick={() => void confirm()}>
              {t('del.confirm')}
            </Button>
          </>
        }
      >
        {!pending?.effects ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-fg-2">{fx.length ? t('del.intro') : t('del.nothing')}</p>
            {stock.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-fg-3">{t('del.stockGroup')}</p>
                <ul className="divide-y divide-line rounded-card border border-line bg-card">
                  {stock.map((e) => (
                    <li key={e.name} className="flex items-center justify-between px-3 py-2">
                      <span className="text-fg">{e.name}</span>
                      <span className={`num inline-flex items-center gap-1 ${e.change >= 0 ? 'text-success' : 'text-danger'}`}>
                        {e.change >= 0 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                        <span dir="ltr">{e.change >= 0 ? '+' : ''}{f.number(Number(e.change), 3)}</span> {t(`unit.${e.unit}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {others.length > 0 && (
              <ul className="space-y-2">
                {others.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-fg-2">
                    <Info className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.5} />
                    {line(e)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </DeleteContext.Provider>
  );
}

export function useDeleteRecord(): DeleteFn {
  const ctx = useContext(DeleteContext);
  if (!ctx) throw new Error('useDeleteRecord must be used inside DeleteProvider');
  return ctx;
}
