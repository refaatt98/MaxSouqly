import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { motion } from 'motion/react';
import { KeyRound, Lock, Mail } from 'lucide-react';
import { useT } from '@/i18n';
import { useAuth, AuthError } from '@/app/providers/AuthProvider';
import { homeFor, usePermissions } from '@/app/providers/PermissionsProvider';
import { BrandMark } from '@/app/shell/BrandMark';
import { LanguageSwitcher } from '@/app/shell/LanguageSwitcher';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Tabs';
import { Keypad } from '@/components/ui/Keypad';
import { cn } from '@/lib/cn';
import type { TranslationKey } from '@/i18n';

const AUTH_ERRORS: Record<AuthError['code'], TranslationKey> = {
  invalidCredentials: 'auth.invalidCredentials',
  wrongPin: 'auth.wrongPin',
  tooManyAttempts: 'auth.tooManyAttempts',
  inactive: 'auth.inactive',
  network: 'errors.network',
  generic: 'errors.generic',
};

function authErrorKey(err: unknown): TranslationKey {
  return err instanceof AuthError ? AUTH_ERRORS[err.code] : 'errors.generic';
}

function EmailForm() {
  const t = useT();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t('auth.invalidEmail');
    if (password.length < 6) next.password = t('auth.passwordShort');
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setErrors({ form: t(authErrorKey(err)) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextInput
        label={t('auth.email')}
        type="email"
        autoComplete="username"
        dir="ltr"
        icon={<Mail className="size-4" />}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        inputSize="lg"
        data-autofocus
      />
      <TextInput
        label={t('auth.password')}
        type="password"
        autoComplete="current-password"
        dir="ltr"
        icon={<Lock className="size-4" />}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        inputSize="lg"
      />
      {errors.form && (
        <p role="alert" className="rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          {errors.form}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        {pending ? t('auth.signingIn') : t('auth.signIn')}
      </Button>
    </form>
  );
}

function PinForm() {
  const t = useT();
  const { pinLogin } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (value: string) => {
    if (!/^\d{4,6}$/.test(value)) return;
    setPending(true);
    setError(null);
    try {
      await pinLogin(value);
    } catch (err) {
      setError(t(authErrorKey(err)));
      setShake((s) => s + 1);
      setPin('');
    } finally {
      setPending(false);
    }
  };

  const onKey = (k: string) => {
    if (pending) return;
    setError(null);
    if (k === 'back') setPin((p) => p.slice(0, -1));
    else if (k === 'C') setPin('');
    else if (k === 'OK') void submit(pin);
    else if (pin.length < 6) setPin((p) => p + k);
  };

  // physical keyboard support for tablets with keyboards
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) onKey(e.key);
      else if (e.key === 'Backspace') onKey('back');
      else if (e.key === 'Enter') onKey('OK');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="font-medium">{t('auth.pinTitle')}</p>
        <p className="mt-1 text-xs text-fg-3">{t('auth.pinHint')}</p>
      </div>
      <motion.div key={shake} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : undefined} transition={{ duration: 0.35 }} className="flex justify-center gap-3" dir="ltr" aria-live="polite">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-4 rounded-full border-2 transition-[color,background-color,border-color,opacity,transform]',
              i < pin.length ? 'border-fg bg-fg' : 'border-line-strong',
              i >= 4 && i >= pin.length && 'opacity-40',
            )}
          />
        ))}
      </motion.div>
      {error && (
        <p role="alert" className="text-center text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <Keypad onKey={onKey} decimal={false} extra={{ label: t('auth.pinClear'), value: 'C' }} />
      <Button variant="primary" size="lg" block loading={pending} disabled={pin.length < 4} onClick={() => void submit(pin)} icon={<KeyRound className="size-5" />}>
        {t('auth.signIn')}
      </Button>
    </div>
  );
}

export default function LoginPage() {
  const t = useT();
  const { status, role } = useAuth();
  const { can, ready } = usePermissions();
  const [mode, setMode] = useState<'email' | 'pin'>(() => (window.matchMedia('(pointer: coarse)').matches ? 'pin' : 'email'));

  if (status === 'signedIn' && role && ready) return <Navigate to={homeFor(role, can)} replace />;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      {/* Form side (start / right in RTL) */}
      <div className="relative flex flex-col justify-center px-6 pt-24 pb-10 sm:px-12 lg:py-10">
        <div className="absolute inset-x-6 top-6 flex items-center justify-between sm:inset-x-12">
          <BrandMark size="sm" className="lg:invisible" />
          <LanguageSwitcher className="w-48" />
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-sm">
          <h1 className="text-[1.75rem] leading-tight font-medium">{t('auth.title')}</h1>
          <p className="mt-2 text-sm text-fg-3">{t('auth.subtitle')}</p>
          <Segmented
            className="mt-8 w-full"
            layoutId="login-mode"
            items={[
              { key: 'email', label: t('auth.emailTab'), icon: <Mail className="size-4" /> },
              { key: 'pin', label: t('auth.pinTab'), icon: <KeyRound className="size-4" /> },
            ]}
            value={mode}
            onChange={setMode}
          />
          <div className="mt-6">{mode === 'email' ? <EmailForm /> : <PinForm />}</div>
        </motion.div>
        <p className="mt-10 text-center text-xs text-fg-3">{t('app.version')}</p>
      </div>

      {/* Brand side */}
      <div className="pattern relative hidden overflow-hidden border-s border-line bg-surface lg:block">
        <div className="relative flex h-full flex-col items-center justify-center p-12 text-center">
          {/* Real photo at public/images/login-burger.webp; falls back to the drawing if missing */}
          <motion.img
            src="/images/login-burger.webp"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.endsWith('.svg')) {
                img.src = '/images/hero-burger.svg';
                img.className = 'w-[min(400px,72%)]';
              }
            }}
            alt=""
            className="w-[min(440px,78%)] drop-shadow-[0_30px_34px_rgba(0,0,0,0.55)]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
          <BrandMark size="lg" withSlogan className="mt-8 items-center" />
          <p className="mt-8 text-xl font-medium">{t('auth.heroLine')}</p>
          <p className="mt-2 max-w-md text-fg-3">{t('auth.heroSub')}</p>
        </div>
      </div>
    </div>
  );
}
