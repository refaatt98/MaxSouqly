import { cn } from '@/lib/cn';
import { useI18n, type Language } from '@/i18n';
import { useAuth } from '../providers/AuthProvider';

const LANGS: { code: Language; label: string; short: string }[] = [
  { code: 'ar', label: 'عربي', short: 'ع' },
  { code: 'he', label: 'עברית', short: 'ע' },
];

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { lang, setLang, t } = useI18n();
  const { status, setLanguage } = useAuth();
  const choose = (code: Language) => {
    if (status === 'signedIn') void setLanguage(code);
    else setLang(code);
  };
  return (
    <div role="radiogroup" aria-label={t('topbar.language')} className={cn('grid grid-cols-2 gap-1 rounded-btn border border-line bg-bg/60 p-1', className)}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={lang === l.code}
          onClick={() => choose(l.code)}
          className={cn(
            'h-8 rounded-[6px] text-xs transition-colors',
            lang === l.code ? 'bg-elevated font-medium text-fg shadow-glow-sm' : 'text-fg-3 hover:text-fg-2',
          )}
          lang={l.code}
        >
          {compact ? l.short : l.label}
        </button>
      ))}
    </div>
  );
}
