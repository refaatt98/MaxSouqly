import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { useAuth, ROLE_HOME } from './providers/AuthProvider';
import { useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import type { AppRole } from '@/types/models';
import { BrandMark } from './shell/BrandMark';

export function FullScreenLoader() {
  const t = useT();
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" role="status" aria-label={t('app.loading')}>
      <div className="flex flex-col items-center gap-5">
        <BrandMark size="lg" />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-black/5">
          <div className="skeleton h-full w-full" />
        </div>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function Forbidden() {
  const t = useT();
  const { role } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
      <div>
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-card border border-line bg-elevated text-fg-3">
          <ShieldCheck className="size-8" />
        </div>
        <h1 className="text-2xl font-semibold">{t('forbidden.title')}</h1>
        <p className="mt-2 text-fg-3">{t('forbidden.body')}</p>
        <Button className="mt-6" variant="primary" onClick={() => navigate(role ? ROLE_HOME[role] : '/')}>
          {t('notFound.home')}
        </Button>
      </div>
    </div>
  );
}

/** Role gate. With `redirectHome`, unauthorized users are sent to their role's home screen. */
export function RequireRole({ roles, redirectHome = false }: { roles: AppRole[]; redirectHome?: boolean }) {
  const { role } = useAuth();
  if (!role) return null;
  if (!roles.includes(role)) return redirectHome ? <Navigate to={ROLE_HOME[role]} replace /> : <Forbidden />;
  return <Outlet />;
}
