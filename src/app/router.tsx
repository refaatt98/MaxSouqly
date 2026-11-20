import { Navigate, createBrowserRouter, type LazyRouteFunction, type RouteObject } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RequireAuth, RequireRole } from './guards';
import { ErrorPage, NotFound } from './pages';

type Loader = () => Promise<{ default: React.ComponentType }>;

const RELOAD_KEY = 'max.chunk-reload';

/**
 * After a new deploy the old file names of code-split screens no longer exist. If a screen fails to
 * load, reload once to pick up the new version (guarded so a real error can't loop).
 */
/** Reload into the screen the user was opening (during a lazy load the URL hasn't changed yet). */
function reloadToTarget(): void {
  const target = router.state.navigation.location;
  if (target) window.location.assign(target.pathname + target.search);
  else window.location.reload();
}

async function loadWithRecovery(load: Loader): Promise<{ default: React.ComponentType }> {
  try {
    const mod = await load();
    sessionStorage.removeItem(RELOAD_KEY);
    return mod;
  } catch (err) {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      reloadToTarget();
      return new Promise(() => {}); // keep the loader pending while the page reloads
    }
    throw err;
  }
}

if (typeof window !== 'undefined') {
  // Vite emits this when a preloaded chunk of an old deploy is missing
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      reloadToTarget();
    }
  });
}

// Each feature screen is code-split.
const page = (load: Loader): LazyRouteFunction<RouteObject> => async () => ({ Component: (await loadWithRecovery(load)).default });

export const router = createBrowserRouter([
  { path: '/login', lazy: page(() => import('@/features/auth/LoginPage')), errorElement: <ErrorPage /> },
  // the phone app (build 6) opens /order?start=app: it is staff sign-in now
  { path: '/order', element: <Navigate to="/login" replace /> },
  {
    element: <RequireAuth />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: '/kitchen',
        element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="kitchen" />,
        children: [{ index: true, lazy: page(() => import('@/features/kitchen/KitchenPage')) }],
      },
      {
        element: <AppShell />,
        errorElement: <ErrorPage />,
        children: [
          {
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="reports" redirectHome />,
            children: [{ index: true, lazy: page(() => import('@/features/dashboard/DashboardPage')) }],
          },
          {
            path: 'pos',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="pos" />,
            children: [{ index: true, lazy: page(() => import('@/features/pos/PosPage')) }],
          },
          {
            path: 'orders',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="orders" />,
            children: [{ index: true, lazy: page(() => import('@/features/orders/OrdersPage')) }],
          },
          {
            path: 'menu',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="menu" />,
            children: [{ index: true, lazy: page(() => import('@/features/menu/MenuPage')) }],
          },
          {
            path: 'inventory',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm={['inventory', 'stocktake', 'receive_goods']} />,
            children: [{ index: true, lazy: page(() => import('@/features/inventory/InventoryPage')) }],
          },
          {
            path: 'employees',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="employees" />,
            children: [{ index: true, lazy: page(() => import('@/features/employees/EmployeesPage')) }],
          },
          {
            path: 'reports',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="reports" />,
            children: [{ index: true, lazy: page(() => import('@/features/reports/ReportsPage')) }],
          },
          {
            path: 'staff-meals',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="employees" />,
            children: [{ index: true, lazy: page(() => import('@/features/staff-meals/StaffMealsPage')) }],
          },
          {
            path: 'activity',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="activity" />,
            children: [{ index: true, lazy: page(() => import('@/features/activity/ActivityPage')) }],
          },
          {
            path: 'customers',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="customers" />,
            children: [{ index: true, lazy: page(() => import('@/features/customers/CustomersPage')) }],
          },
          {
            path: 'attendance',
            element: <RequireRole roles={['owner', 'manager', 'cashier', 'kitchen', 'inventory']} perm="attendance" />,
            children: [{ index: true, lazy: page(() => import('@/features/attendance/AttendancePage')) }],
          },
          { path: 'settings', lazy: page(() => import('@/features/settings/SettingsPage')) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
