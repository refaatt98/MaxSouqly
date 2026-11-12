import { useState } from 'react';
import { NavLink } from 'react-router';
import { Ellipsis, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useAuth } from '../providers/AuthProvider';
import { navFor } from '../nav';
import { Modal } from '@/components/ui/Modal';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Mobile bottom navigation: first 4 screens + "more" sheet. */
export function BottomNav() {
  const t = useT();
  const { role, signOut } = useAuth();
  const [more, setMore] = useState(false);
  const items = navFor(role);
  const primary = items.slice(0, 4);
  const rest = items.slice(4);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors', isActive ? 'font-medium text-fg' : 'text-fg-3');

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="bottom navigation">
        {primary.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === '/'} className={linkClass}>
            {({ isActive }) => (
              <>
                <span className={cn('relative grid h-7 w-12 place-items-center rounded-[8px] transition-colors', isActive && 'bg-elevated')}>
                  <item.icon className="size-5" />
                </span>
                {t(item.label)}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-fg-3">
          <span className="grid h-7 w-12 place-items-center"><Ellipsis className="size-5" /></span>
          {t('nav.more')}
        </button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title={t('nav.more')} size="sm">
        <div className="grid grid-cols-3 gap-2">
          {rest.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setMore(false)}
              className={({ isActive }) =>
                cn('flex flex-col items-center gap-2 rounded-card border p-4 text-xs', isActive ? 'border-line-strong bg-elevated font-medium text-fg' : 'border-line bg-card text-fg-2')
              }
            >
              <item.icon className="size-6" />
              {t(item.label)}
            </NavLink>
          ))}
        </div>
        <LanguageSwitcher className="mt-4" />
        <button type="button" onClick={() => void signOut()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-btn border border-line text-sm text-fg-2">
          <LogOut className="size-5 rtl:-scale-x-100" /> {t('nav.logout')}
        </button>
      </Modal>
    </>
  );
}
