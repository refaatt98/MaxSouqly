import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useSettings } from '../providers/SettingsProvider';
import { canAccess, navFor } from '../nav';
import { FoodImage } from '@/components/ui/FoodImage';
import type { MenuItem } from '@/types/models';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  go: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { name, f } = useSettings();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (products.length === 0) {
      void supabase.from('menu_items').select('*').order('name_ar').then(({ data }) => data && setProducts(data));
    }
  }, [open, products.length]);

  const entries = useMemo<{ section: string; items: Entry[] }[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const screens = navFor(role)
      .filter((n) => match(t(n.label)))
      .map<Entry>((n) => ({ id: n.path, label: t(n.label), icon: <n.icon className="size-4" />, go: () => navigate(n.path) }));
    const toPos = canAccess(role, '/pos');
    const toMenu = canAccess(role, '/menu');
    const prods =
      needle && (toPos || toMenu)
        ? products
            .filter((p) => match(p.name_ar) || match(p.name_he) || (p.barcode ?? '').includes(needle))
            .slice(0, 8)
            .map<Entry>((p) => ({
              id: p.id,
              label: name(p),
              hint: f.money(Number(p.price)),
              icon: <FoodImage src={p.image_url} alt="" className="size-7" />,
              go: () => navigate(toPos ? `/pos?q=${encodeURIComponent(p.name_ar)}` : `/menu?edit=${p.id}`),
            }))
        : [];
    return [
      { section: t('command.screens'), items: screens },
      { section: t('command.products'), items: prods },
    ].filter((s) => s.items.length > 0);
  }, [q, role, t, navigate, products, name, f]);

  const flat = entries.flatMap((s) => s.items);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      flat[active].go();
      onClose();
    } else if (e.key === 'Escape') onClose();
  };

  let idx = -1;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[55] flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('topbar.commandHint')}
            initial={{ y: -10, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            className="glass relative w-full max-w-xl overflow-hidden rounded-panel border border-line-strong shadow-panel"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-5 text-fg-3" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                placeholder={t('command.placeholder')}
                className="h-14 w-full bg-transparent text-base text-fg placeholder:text-fg-3 focus:outline-none"
                aria-label={t('command.placeholder')}
              />
              <kbd className="rounded border border-line px-1.5 text-[11px] text-fg-3">Esc</kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {flat.length === 0 && <p className="px-3 py-8 text-center text-sm text-fg-3">{t('command.empty')}</p>}
              {entries.map((s) => (
                <div key={s.section} className="mb-1">
                  <p className="px-3 py-2 text-xs font-semibold text-fg-3">{s.section}</p>
                  {s.items.map((e) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => {
                          e.go();
                          onClose();
                        }}
                        className={cn('flex h-12 w-full items-center gap-3 rounded-btn px-3 text-start text-sm', i === active ? 'bg-elevated text-fg' : 'text-fg-2')}
                      >
                        <span className="grid size-8 place-items-center rounded-btn bg-white/5">{e.icon}</span>
                        <span className="flex-1 truncate">{e.label}</span>
                        {e.hint && <span className="num text-xs text-fg-3">{e.hint}</span>}
                        {i === active && <CornerDownLeft className="size-4 text-fg-3" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
