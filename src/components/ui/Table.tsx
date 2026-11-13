import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Trash, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { SkeletonRows } from './Skeleton';
import { Button } from './Button';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'start' | 'end' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg';
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };
const align = { start: 'text-start', end: 'text-end', center: 'text-center' };

/** Tick box used for multi-select in tables and card grids. */
export function SelectBox({ checked, indeterminate, onChange, label, className }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate) && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={cn('size-[1.125rem] shrink-0 cursor-pointer rounded accent-[var(--color-brand)]', className)}
    />
  );
}

export interface Selection {
  ids: Set<string>;
  has: (id: string) => boolean;
  toggle: (id: string, on?: boolean) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
  count: number;
}

/** Selected row ids; ids that disappear from `available` drop out automatically. */
export function useSelection(available: string[]): Selection {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const key = available.join(',');
  useEffect(() => {
    setIds((cur) => {
      const keep = new Set(available);
      const next = new Set([...cur].filter((id) => keep.has(id)));
      return next.size === cur.size ? cur : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = useCallback((id: string, on?: boolean) => {
    setIds((cur) => {
      const next = new Set(cur);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const setAll = useCallback((list: string[], on: boolean) => {
    setIds((cur) => {
      const next = new Set(cur);
      for (const id of list) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setIds(new Set()), []);
  return useMemo(() => ({ ids, has: (id: string) => ids.has(id), toggle, setAll, clear, count: ids.size }), [ids, toggle, setAll, clear]);
}

/** Floating bar shown while rows are selected: count, delete selected, clear. */
export function BulkBar({ selection, onDelete, busy, extra }: { selection: Selection; onDelete: () => void; busy?: boolean; extra?: ReactNode }) {
  const t = useT();
  const { f } = useSettings();
  return (
    <AnimatePresence>
      {selection.count > 0 && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-xl items-center gap-2 rounded-panel border border-line-strong bg-elevated px-4 py-3 shadow-panel md:bottom-6"
          role="region"
          aria-label={t('bulk.selected', { count: f.number(selection.count) })}
        >
          <span className="num flex-1 text-sm text-fg">{t('bulk.selected', { count: f.number(selection.count) })}</span>
          {extra}
          <Button variant="danger" size="sm" icon={<Trash className="size-4" />} loading={busy} onClick={onDelete}>
            {t('bulk.delete')}
          </Button>
          <button type="button" onClick={selection.clear} aria-label={t('bulk.clear')} className="grid size-9 place-items-center rounded-btn text-fg-3 hover:bg-fg/5 hover:text-fg">
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, empty, className, rowClassName, selection, canSelect }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  /** adds a tick-box column for multi-select */
  selection?: Selection;
  canSelect?: (row: T) => boolean;
}) {
  const t = useT();
  if (loading) return <SkeletonRows rows={6} />;
  if (rows.length === 0) return <>{empty}</>;
  const selectable = selection ? rows.filter((r) => !canSelect || canSelect(r)).map(rowKey) : [];
  const allOn = selectable.length > 0 && selectable.every((id) => selection?.has(id));
  const someOn = selectable.some((id) => selection?.has(id));
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="sticky top-0 z-[1] w-10 border-b border-line bg-card ps-4 pe-0 py-3">
                <SelectBox checked={allOn} indeterminate={someOn} onChange={(on) => selection.setAll(selectable, on)} label={t('bulk.selectAll')} />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'sticky top-0 z-[1] border-b border-line bg-card px-4 py-3 text-xs font-medium whitespace-nowrap text-fg-3',
                  align[c.align ?? 'start'],
                  c.hideBelow && hide[c.hideBelow],
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                'group transition-colors',
                onRowClick && 'cursor-pointer hover:bg-fg/[0.03] focus-visible:bg-fg/[0.05]',
                selection?.has(rowKey(r)) && 'bg-brand/[0.06]',
                rowClassName?.(r),
              )}
            >
              {selection && (
                <td className="w-10 border-b border-line ps-4 pe-0 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                  {(!canSelect || canSelect(r)) && (
                    <SelectBox checked={selection.has(rowKey(r))} onChange={(on) => selection.toggle(rowKey(r), on)} label={t('bulk.selectRow')} />
                  )}
                </td>
              )}
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('border-b border-line px-4 py-3 align-middle', align[c.align ?? 'start'], c.hideBelow && hide[c.hideBelow], c.className)}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
