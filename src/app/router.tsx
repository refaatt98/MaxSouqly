import { createBrowserRouter, type LazyRouteFunction, type RouteObject } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RequireAuth, RequireRole } from './guards';
import { ErrorPage, NotFound } from './pages';

type Loader = () => Promise<{ default: React.ComponentType }>;

// Each feature screen is code-split.
const page = (load: Loader): LazyRouteFunction<RouteObject> => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
  { path: '/login', lazy: page(() => import('@/features/auth/LoginPage')), errorElement: <ErrorPage /> },
  {
    element: <RequireAuth />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: '/kitchen',
        element: <RequireRole roles={['owner', 'manager', 'kitchen']} />,
        children: [{ index: true, lazy: page(() => import('@/features/kitchen/KitchenPage')) }],
      },
      {
        element: <AppShell />,
        errorElement: <ErrorPage />,
        children: [
          {
            element: <RequireRole roles={['owner', 'manager']} redirectHome />,
            children: [{ index: true, lazy: page(() => import('@/features/dashboard/DashboardPage')) }],
          },
          {
            path: 'pos',
            element: <RequireRole roles={['owner', 'manager', 'cashier']} />,
            children: [{ index: true, lazy: page(() => import('@/features/pos/PosPage')) }],
          },
          {
            path: 'orders',
            element: <RequireRole roles={['owner', 'manager', 'cashier']} />,
            children: [{ index: true, lazy: page(() => import('@/features/orders/OrdersPage')) }],
          },
          {
            path: 'menu',
            element: <RequireRole roles={['owner', 'manager']} />,
            children: [{ index: true, lazy: page(() => import('@/features/menu/MenuPage')) }],
          },
          {
            path: 'inventory',
            element: <RequireRole roles={['owner', 'manager', 'inventory']} />,
            children: [{ index: true, lazy: page(() => import('@/features/inventory/InventoryPage')) }],
          },
          {
            path: 'employees',
            element: <RequireRole roles={['owner', 'manager']} />,
            children: [{ index: true, lazy: page(() => import('@/features/employees/EmployeesPage')) }],
          },
          {
            path: 'reports',
            element: <RequireRole roles={['owner', 'manager']} />,
            children: [{ index: true, lazy: page(() => import('@/features/reports/ReportsPage')) }],
          },
          { path: 'settings', lazy: page(() => import('@/features/settings/SettingsPage')) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
