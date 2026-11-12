import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { cacheGet, cacheSet } from '@/lib/offlineQueue';
import { createFormatter, type Formatter } from '@/lib/format';
import { useI18n } from '@/i18n';
import { useRealtime } from '@/hooks/useRealtime';
import type { Settings } from '@/types/models';
import { useAuth } from './AuthProvider';

interface SettingsContextValue {
  settings: Settings | null;
  loading: boolean;
  f: Formatter;
  update: (patch: Partial<Settings>) => Promise<void>;
  /** Localised name of a catalog row. */
  name: (row: { name_ar: string; name_he?: string | null }) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const CACHE_KEY = 'settings';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { lang } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('restaurant_settings').select('*').limit(1).maybeSingle();
      if (cancelled) return;
      if (data && !error) {
        setSettings(data);
        void cacheSet(CACHE_KEY, data);
      } else {
        const cached = await cacheGet<Settings>(CACHE_KEY);
        if (cached && !cancelled) setSettings(cached);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useRealtime(status === 'signedIn' ? { table: 'restaurant_settings', event: 'UPDATE' } : null, (p) => {
    if (p.eventType === 'UPDATE') {
      setSettings(p.new);
      void cacheSet(CACHE_KEY, p.new);
    }
  });

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      if (!settings) return;
      const { data, error } = await supabase.from('restaurant_settings').update(patch).eq('id', settings.id).select('*').single();
      if (error) throw error;
      setSettings(data);
      void cacheSet(CACHE_KEY, data);
    },
    [settings],
  );

  const f = useMemo(
    () =>
      createFormatter({
        lang,
        digits: settings?.digit_style === 'arabic' ? 'arabic' : 'latin',
        currencySymbol: settings?.currency_symbol ?? '₪',
      }),
    [lang, settings?.digit_style, settings?.currency_symbol],
  );

  const name = useCallback((row: { name_ar: string; name_he?: string | null }) => (lang === 'he' && row.name_he ? row.name_he : row.name_ar), [lang]);

  const value = useMemo(() => ({ settings, loading, f, update, name }), [settings, loading, f, update, name]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}

export function useFormat(): Formatter {
  return useSettings().f;
}
