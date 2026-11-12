import { Delete } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Big touch numeric keypad. `decimal` adds a "." key. */
export function Keypad({ onKey, decimal = true, className, extra }: {
  onKey: (key: string) => void;
  decimal?: boolean;
  className?: string;
  extra?: { label: string; value: string };
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : extra?.value ?? 'C', '0', 'back'];
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)} dir="ltr">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          aria-label={k === 'back' ? 'backspace' : k}
          className="num grid h-14 place-items-center rounded-btn border border-line bg-elevated text-xl font-semibold text-fg transition-all hover:border-line-strong hover:bg-[#2b2b33] active:scale-95 active:bg-brand/30"
        >
          {k === 'back' ? <Delete className="size-5" /> : !decimal && k === (extra?.value ?? 'C') ? extra?.label ?? 'C' : k}
        </button>
      ))}
    </div>
  );
}

/** Applies a keypad key to a numeric string. */
export function applyKey(current: string, key: string, maxDecimals = 2): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === 'C') return '';
  if (key === '.') return current.includes('.') ? current : (current || '0') + '.';
  const next = current === '0' ? key : current + key;
  const [, dec] = next.split('.');
  if (dec && dec.length > maxDecimals) return current;
  if (next.replace('.', '').length > 8) return current;
  return next;
}
