import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { env, isSupabaseConfigured } from '@/lib/env';
import { useI18n, type Language } from '@/i18n';
import type { AppRole, Profile } from '@/types/models';

export const PROFILE_COLUMNS = 'id, full_name, role, avatar_url, language, is_active, last_login_at, created_at, updated_at';
const PROFILE_CACHE = 'max.profile';

type Status = 'loading' | 'signedOut' | 'signedIn';

export class AuthError extends Error {
  constructor(public code: 'invalidCredentials' | 'wrongPin' | 'tooManyAttempts' | 'inactive' | 'network' | 'generic') {
    super(code);
  }
}

interface AuthContextValue {
  status: Status;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  signIn: (email: string, password: string) => Promise<void>;
  pinLogin: (pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'language'>>) => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    return p.id === userId ? p : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [status, setStatus] = useState<Status>(isSupabaseConfigured ? 'loading' : 'signedOut');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const loadedFor = useRef<string | null>(null);

  const applyProfile = useCallback(
    (p: Profile) => {
      setProfile(p);
      if (p.language === 'ar' || p.language === 'he') setLang(p.language);
      try {
        localStorage.setItem(PROFILE_CACHE, JSON.stringify(p));
      } catch {
        /* ignore */
      }
    },
    [setLang],
  );

  const loadProfile = useCallback(
    async (s: Session) => {
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', s.user.id).maybeSingle();
      if (error || !data) {
        // Offline after a reload: keep working with the cached profile so the POS stays usable.
        const cached = readCachedProfile(s.user.id);
        if (cached) {
          applyProfile(cached);
          setStatus('signedIn');
          return;
        }
        await supabase.auth.signOut();
        setStatus('signedOut');
        return;
      }
      const p = data as Profile;
      if (!p.is_active) {
        await supabase.auth.signOut();
        setProfile(null);
        setStatus('signedOut');
        return;
      }
      applyProfile(p);
      setStatus('signedIn');
    },
    [applyProfile],
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        loadedFor.current = data.session.user.id;
        void loadProfile(data.session);
      } else setStatus('signedOut');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) {
        loadedFor.current = null;
        setProfile(null);
        setStatus('signedOut');
        return;
      }
      if (event === 'SIGNED_IN' && loadedFor.current !== s.user.id) {
        loadedFor.current = s.user.id;
        // defer: never call supabase inside the auth callback synchronously
        setTimeout(() => {
          void loadProfile(s);
          void supabase.rpc('touch_last_login');
        }, 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      if (/fetch|network/i.test(error.message)) throw new AuthError('network');
      throw new AuthError(/invalid/i.test(error.message) ? 'invalidCredentials' : 'generic');
    }
    const { data: p } = await supabase.from('profiles').select('is_active').eq('id', data.user.id).maybeSingle();
    if (p && !p.is_active) {
      await supabase.auth.signOut();
      throw new AuthError('inactive');
    }
  }, []);

  const pinLogin = useCallback(async (pin: string) => {
    let res: Response;
    try {
      res = await fetch(`${env.supabaseUrl}/functions/v1/pin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseAnonKey}` },
        body: JSON.stringify({ pin }),
      });
    } catch {
      throw new AuthError('network');
    }
    if (res.status === 401) throw new AuthError('wrongPin');
    if (res.status === 429) throw new AuthError('tooManyAttempts');
    if (!res.ok) throw new AuthError('generic');
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    const { error } = await supabase.auth.setSession(body);
    if (error) throw new AuthError('generic');
  }, []);

  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem(PROFILE_CACHE);
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut();
  }, []);

  const updateProfile = useCallback<AuthContextValue['updateProfile']>(
    async (patch) => {
      if (!profile) return;
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', profile.id).select(PROFILE_COLUMNS).single();
      if (error) throw error;
      applyProfile(data as Profile);
    },
    [profile, applyProfile],
  );

  const setLanguage = useCallback(
    async (lang: Language) => {
      setLang(lang);
      if (profile && profile.language !== lang) {
        setProfile({ ...profile, language: lang });
        await supabase.from('profiles').update({ language: lang }).eq('id', profile.id);
      }
    },
    [profile, setLang],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, role: profile?.role ?? null, signIn, pinLogin, signOut, updateProfile, setLanguage }),
    [status, session, profile, signIn, pinLogin, signOut, updateProfile, setLanguage],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

