import { RefreshCw, WifiOff } from 'lucide-react';
import { useT } from '@/i18n';
import { useConnection } from '../providers/ConnectionProvider';
import { useSettings } from '../providers/SettingsProvider';
import { Button } from '@/components/ui/Button';

export function OfflineBanner() {
  const t = useT();
  const { online, queueCount, syncing, syncNow } = useConnection();
  const { settings } = useSettings();
  if (online && queueCount === 0) return null;
  const offlineEnabled = settings?.offline_mode ?? true;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-3 bg-danger/90 px-4 py-2 text-center text-sm font-semibold text-white">
      <WifiOff className="size-4" />
      <span>
        {!online
          ? !offlineEnabled
            ? t('offline.disabled')
            : queueCount > 0
              ? t('offline.banner', { count: queueCount })
              : t('offline.bannerNoQueue')
          : syncing
            ? t('offline.syncing')
            : t('offline.pending', { count: queueCount })}
      </span>
      {online && queueCount > 0 && (
        <Button size="sm" variant="secondary" loading={syncing} icon={<RefreshCw className="size-4" />} onClick={() => void syncNow()}>
          {t('offline.syncNow')}
        </Button>
      )}
    </div>
  );
}
