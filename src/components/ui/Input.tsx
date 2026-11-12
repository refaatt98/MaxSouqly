import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-btn border bg-surface text-fg placeholder:text-fg-3 transition-colors focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-fg-3 disabled:opacity-50';

export function Field({ label, error, hint, children, htmlFor, className, required }: {
  label?: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-fg-2">
          {label}
          {required && <span className="ms-0.5 text-brand">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">{error}</p>
      ) : (
        hint && <p className="text-xs text-fg-3">{hint}</p>
      )}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  inputSize?: 'md' | 'lg';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, error, hint, icon, suffix, className, id, inputSize = 'md', required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={inputId} className={className} required={required}>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-3">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          required={required}
          className={cn(
            control,
            inputSize === 'lg' ? 'h-14 text-lg' : 'h-11 text-sm',
            icon ? 'ps-10' : 'ps-3.5',
            suffix ? 'pe-12' : 'pe-3.5',
            error ? 'border-danger/60' : 'border-line-strong',
          )}
          {...rest}
        />
        {suffix && <span className="absolute inset-y-0 end-3 flex items-center text-sm text-fg-3">{suffix}</span>}
      </div>
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, rows = 3, required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={inputId} className={className} required={required}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(control, 'resize-none px-3.5 py-2.5 text-sm', error ? 'border-danger/60' : 'border-line-strong')}
        {...rest}
      />
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string | null;
  hint?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className, id, options, placeholder, required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={inputId} className={className} required={required}>
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(control, 'h-11 appearance-none ps-3.5 pe-10 text-sm', error ? 'border-danger/60' : 'border-line-strong')}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
      </div>
    </Field>
  );
});
