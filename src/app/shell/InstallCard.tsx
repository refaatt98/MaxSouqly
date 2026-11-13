import { Download, MonitorSmartphone } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useInstall } from '@/lib/install';
import { Button } from '@/components/ui/Button';

/** Install MAX as an app on this device (its own icon and window, opens straight to the system). */
export function InstallCard() {
  const { t } = useI18n();
  const { canInstall, installed, install, ios } = useInstall();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
      <MonitorSmartphone className="size-6 shrink-0 text-fg-3" strokeWidth={1.5} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-fg">{t('install.title')}</p>
        <p className="text-fg-3">{installed ? t('install.done') : canInstall ? t('install.hint') : ios ? t('install.ios') : t('install.browser')}</p>
      </div>
      {canInstall && !installed && (
        <Button variant="primary" icon={<Download className="size-4" />} onClick={() => void install()}>
          {t('install.button')}
        </Button>
      )}
    </div>
  );
}
