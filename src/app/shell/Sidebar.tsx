import { NavLink } from 'react-router';
import { LogOut, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { useAuth } from '../providers/AuthProvider';
import { navFor } from '../nav';
import { usePermissions } from '../providers/PermissionsProvider';
import { BrandMark } from './BrandMark';
import { Avatar } from '@/components/ui/Avatar';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const { profile, role, signOut } = useAuth();
  const { can } = usePermissions();
  const items = navFor(role, can);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-surface transition-[width] duration-300 md:flex',
        collapsed ? 'w-[4.5rem]' : 'w-[15.5rem]',
      )}
      aria-label="sidebar"
    >
      <div className={cn('flex h-16 items-center border-b border-line', collapsed ? 'justify-center' : 'justify-between ps-5 pe-3')}>
        {collapsed ? <span className="inline-block h-5 w-1.5 -skew-x-12 rounded-[2px] bg-brand" aria-label="MAX" /> : <BrandMark />}
        {!collapsed && (
          <button type="button" onClick={onToggle} className="grid size-9 place-items-center rounded-btn text-fg-3 hover:bg-fg/5 hover:text-fg" aria-label={t('nav.collapse')} title={t('nav.collapse')}>
            <PanelRightClose className="size-[1.125rem] rtl:-scale-x-100" strokeWidth={1.5} />
          </button>
        )}
      </div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {collapsed && (
          <button type="button" onClick={onToggle} className="mb-2 grid h-10 w-full place-items-center rounded-btn text-fg-3 hover:bg-fg/5 hover:text-fg" aria-label={t('nav.expand')} title={t('nav.expand')}>
            <PanelRightOpen className="size-[1.125rem] rtl:-scale-x-100" strokeWidth={1.5} />
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
                'relative flex h-10 items-center gap-2.5 rounded-btn text-sm transition-colors',
                collapsed ? 'justify-center' : 'ps-4 pe-3',
                isActive ? 'bg-elevated font-medium text-fg shadow-glow-sm' : 'text-fg-2 hover:bg-fg/[0.04] hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className={cn('slash absolute top-1/2 -translate-y-1/2', collapsed ? 'start-2' : 'start-1.5')} aria-hidden />}
                <item.icon className={cn('size-[1.125rem] shrink-0', isActive ? 'text-fg' : 'text-fg-3')} strokeWidth={1.5} aria-hidden />
                {!collapsed && <span className="truncate">{t(item.label)}</span>}
                
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 border-t border-line p-3">
        <LanguageSwitcher compact={collapsed} />
        {profile && (
          <div className={cn('flex items-center gap-2.5 px-1 py-1', collapsed && 'justify-center')}>
            <Avatar name={profile.full_name} url={profile.avatar_url} size="sm" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile.full_name}</p>
                <p className="truncate text-xs text-fg-3">{t(`role.${profile.role}`)}</p>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          title={t('nav.logout')}
          className={cn('flex h-10 w-full items-center gap-2.5 rounded-btn text-sm text-fg-3 transition-colors hover:bg-fg/[0.04] hover:text-fg', collapsed ? 'justify-center' : 'px-3')}
        >
          <LogOut className="size-[1.125rem] rtl:-scale-x-100" strokeWidth={1.5} />
          {!collapsed && t('nav.logout')}
        </button>
      </div>
    </aside>
  );
}
