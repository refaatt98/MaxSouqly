import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SkeletonRows } from './Skeleton';

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

export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, empty, className, rowClassName }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (loading) return <SkeletonRows rows={6} />;
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
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
              className={cn('group transition-colors', onRowClick && 'cursor-pointer hover:bg-fg/[0.03] focus-visible:bg-fg/[0.05]', rowClassName?.(r))}
            >
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
