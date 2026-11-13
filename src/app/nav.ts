import { Boxes, ChartColumn, ChefHat, Clock, ClipboardList, Contact, LayoutDashboard, MonitorSmartphone, ScrollText, Settings, Users, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/i18n';
import type { AppRole } from '@/types/models';
import type { Permission } from './providers/PermissionsProvider';

export interface NavItem {
  path: string;
  label: TranslationKey;
  icon: LucideIcon;
  roles: AppRole[];
  /** besides the role, non-owners need this grant from the owner */
  perm?: Permission;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'nav.dashboard', icon: LayoutDashboard, roles: ['owner', 'manager'], perm: 'reports' },
  { path: '/pos', label: 'nav.pos', icon: MonitorSmartphone, roles: ['owner', 'manager', 'cashier'] },
  { path: '/kitchen', label: 'nav.kitchen', icon: ChefHat, roles: ['owner', 'manager', 'kitchen'] },
  { path: '/orders', label: 'nav.orders', icon: ClipboardList, roles: ['owner', 'manager', 'cashier'] },
  { path: '/customers', label: 'nav.customers', icon: Contact, roles: ['owner', 'manager'], perm: 'customers' },
  { path: '/menu', label: 'nav.menu', icon: UtensilsCrossed, roles: ['owner', 'manager'] },
  { path: '/inventory', label: 'nav.inventory', icon: Boxes, roles: ['owner', 'manager', 'inventory', 'cashier'] },
  { path: '/attendance', label: 'nav.attendance', icon: Clock, roles: ['owner', 'manager', 'cashier', 'kitchen', 'inventory'] },
  { path: '/employees', label: 'nav.employees', icon: Users, roles: ['owner', 'manager'], perm: 'employees' },
  { path: '/reports', label: 'nav.reports', icon: ChartColumn, roles: ['owner', 'manager'], perm: 'reports' },
  { path: '/activity', label: 'nav.activity', icon: ScrollText, roles: ['owner', 'manager'], perm: 'activity' },
  { path: '/settings', label: 'nav.settings', icon: Settings, roles: ['owner', 'manager', 'cashier', 'kitchen', 'inventory'] },
];

const allowed = (n: NavItem, role: AppRole, can: (p: Permission) => boolean) => n.roles.includes(role) && (!n.perm || can(n.perm));

export function navFor(role: AppRole | null, can: (p: Permission) => boolean): NavItem[] {
  return role ? NAV_ITEMS.filter((n) => allowed(n, role, can)) : [];
}

export function canAccess(role: AppRole | null, path: string, can: (p: Permission) => boolean): boolean {
  const item = NAV_ITEMS.find((n) => n.path === path);
  return Boolean(role && item && allowed(item, role, can));
}
