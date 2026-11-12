import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'info' | 'order';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  order: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = {
  success: <CircleCheck className="size-5 text-success" />,
  error: <TriangleAlert className="size-5 text-danger" />,
  info: <Info className="size-5 text-[#7aa5ff]" />,
  order: <span className="relative flex size-3"><span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" /><span className="relative inline-flex size-3 rounded-full bg-brand" /></span>,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      order: (m) => push('order', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={cn(
                'glass pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card border px-4 py-3 shadow-panel',
                t.kind === 'order' ? 'border-brand/50 shadow-glow' : 'border-line-strong',
              )}
            >
              {icons[t.kind]}
              <p className="min-w-0 flex-1 text-sm font-semibold text-fg">{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="grid size-8 place-items-center rounded-btn text-fg-3 hover:text-fg" aria-label="×">
                <X className="size-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
