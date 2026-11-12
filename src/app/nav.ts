import { Boxes, ChartColumn, ChefHat, ClipboardList, LayoutDashboard, MonitorSmartphone, Settings, Users, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/i18n';
import type { AppRole } from '@/types/models';

export interface NavItem {
  path: string;
  label: TranslationKey;
  icon: LucideIcon;
  roles: AppRole[];
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'nav.dashboard', icon: LayoutDashboard, roles: ['owner', 'manager'] },
  { path: '/pos', label: 'nav.pos', icon: MonitorSmartphone, roles: ['owner', 'manager', 'cashier'] },
  { path: '/kitchen', label: 'nav.kitchen', icon: ChefHat, roles: ['owner', 'manager', 'kitchen'] },
  { path: '/orders', label: 'nav.orders', icon: ClipboardList, roles: ['owner', 'manager', 'cashier'] },
  { path: '/menu', label: 'nav.menu', icon: UtensilsCrossed, roles: ['owner', 'manager'] },
  { path: '/inventory', label: 'nav.inventory', icon: Boxes, roles: ['owner', 'manager', 'inventory'] },
  { path: '/employees', label: 'nav.employees', icon: Users, roles: ['owner', 'manager'] },
  { path: '/reports', label: 'nav.reports', icon: ChartColumn, roles: ['owner', 'manager'] },
  { path: '/settings', label: 'nav.settings', icon: Settings, roles: ['owner', 'manager', 'cashier', 'kitchen', 'inventory'] },
];

export function navFor(role: AppRole | null): NavItem[] {
  return role ? NAV_ITEMS.filter((n) => n.roles.includes(role)) : [];
}

export function canAccess(role: AppRole | null, path: string): boolean {
  const item = NAV_ITEMS.find((n) => n.path === path);
  return Boolean(role && item?.roles.includes(role));
}
