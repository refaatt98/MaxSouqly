import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

export function Toggle({ checked, onChange, label, description, disabled, id }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-brand bg-brand' : 'border-line-strong bg-elevated',
      )}
    >
      <motion.span
        layout
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className={cn('absolute size-5 rounded-full bg-white shadow', checked ? 'end-1' : 'start-1')}
      />
    </button>
  );
  if (!label) return sw;
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-fg">{label}</label>
        {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
      </div>
      {sw}
    </div>
  );
}
