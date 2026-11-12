import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { BrandMark } from './shell/BrandMark';

export function NotFound() {
  const t = useT();
  return (
    <div className="grid min-h-[70dvh] place-items-center p-6 text-center">
      <div>
        <p className="mono text-[96px] leading-none font-medium text-fg-3">404</p>
        <h1 className="mt-2 text-2xl font-semibold">{t('notFound.title')}</h1>
        <p className="mt-2 text-fg-3">{t('notFound.body')}</p>
        <Link to="/" className="mt-6 inline-flex h-11 items-center rounded-btn bg-brand px-5 text-sm font-medium text-white shadow-glow-sm transition-colors hover:bg-brand-hover">
          {t('notFound.home')}
        </Link>
      </div>
    </div>
  );
}

export function ErrorPage() {
  const t = useT();
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  // A failed lazy chunk after a deploy: reloading fetches the new build.
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6 text-center">
      <div className="max-w-md">
        <BrandMark size="lg" className="mb-8 items-center" />
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-card border border-line bg-elevated text-fg-3">
          <TriangleAlert className="size-8" />
        </div>
        <h1 className="text-2xl font-semibold">{t('error.title')}</h1>
        <p className="mt-2 text-fg-3">{t('error.body')}</p>
        {import.meta.env.DEV && error instanceof Error && <pre className="mt-4 overflow-auto rounded-card bg-card p-3 text-start text-xs text-fg-3" dir="ltr">{error.message}</pre>}
        <Button className="mt-6" variant="primary" onClick={() => window.location.reload()}>
          {t('error.reload')}
        </Button>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const t = useT();
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="max-w-lg rounded-panel border border-line bg-surface p-8 text-center shadow-panel">
        <BrandMark size="lg" withSlogan className="mb-6 items-center" />
        <h1 className="text-xl font-semibold">{t('auth.setupTitle')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-2">{t('auth.setupBody')}</p>
        <pre className="mt-5 rounded-card bg-card p-4 text-start text-xs text-fg-2" dir="ltr">
          {`cp .env.example .env\nVITE_SUPABASE_URL=...\nVITE_SUPABASE_ANON_KEY=...\nnpm run dev`}
        </pre>
      </div>
    </div>
  );
}
