import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { LogOut, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { useAuth } from '../providers/AuthProvider';
import { navFor } from '../nav';
import { BrandMark } from './BrandMark';
import { Avatar } from '@/components/ui/Avatar';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const { profile, role, signOut } = useAuth();
  const items = navFor(role);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-surface/80 transition-[width] duration-300 md:flex',
        collapsed ? 'w-[84px]' : 'w-[264px]',
      )}
      aria-label="sidebar"
    >
      <div className={cn('flex h-20 items-center border-b border-line', collapsed ? 'justify-center' : 'justify-between px-5')}>
        {collapsed ? <span className="inline-block h-7 w-2.5 -skew-x-12 rounded-sm bg-brand shadow-glow-sm" aria-label="MAX" /> : <BrandMark withSlogan />}
        {!collapsed && (
          <button type="button" onClick={onToggle} className="grid size-9 place-items-center rounded-btn text-fg-3 hover:bg-white/5 hover:text-fg" aria-label={t('nav.collapse')} title={t('nav.collapse')}>
            <PanelRightClose className="size-5 rtl:-scale-x-100" />
          </button>
        )}
      </div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto p-3">
        {collapsed && (
          <button type="button" onClick={onToggle} className="mb-2 grid h-11 w-full place-items-center rounded-btn text-fg-3 hover:bg-white/5 hover:text-fg" aria-label={t('nav.expand')} title={t('nav.expand')}>
            <PanelRightOpen className="size-5 rtl:-scale-x-100" />
          </button>
        )}
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            title={collapsed ? t(item.label) : undefined}
            className={({ isActive }) =>
              cn(
                'relative flex h-12 items-center gap-3 rounded-full text-sm font-semibold transition-colors',
                collapsed ? 'justify-center' : 'px-4',
                isActive ? 'text-white' : 'text-fg-2 hover:bg-white/5 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-full bg-brand shadow-glow"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <item.icon className="relative size-5 shrink-0" aria-hidden />
                {!collapsed && <span className="relative truncate">{t(item.label)}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 border-t border-line p-3">
        <LanguageSwitcher compact={collapsed} />
        {profile && (
          <div className={cn('flex items-center gap-3 rounded-card bg-card p-2', collapsed && 'justify-center')}>
            <Avatar name={profile.full_name} url={profile.avatar_url} size="sm" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{profile.full_name}</p>
                <p className="truncate text-xs text-fg-3">{t(`role.${profile.role}`)}</p>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          title={t('nav.logout')}
          className={cn('flex h-11 w-full items-center gap-3 rounded-btn text-sm font-semibold text-fg-3 transition-colors hover:bg-danger/10 hover:text-danger', collapsed ? 'justify-center' : 'px-4')}
        >
          <LogOut className="size-5 rtl:-scale-x-100" />
          {!collapsed && t('nav.logout')}
        </button>
      </div>
    </aside>
  );
}
