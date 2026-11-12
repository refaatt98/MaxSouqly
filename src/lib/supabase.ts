import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env, isSupabaseConfigured } from './env';

// When env vars are missing the app renders a setup screen instead of calling this client.
export const supabase = createClient<Database>(
  isSupabaseConfigured ? env.supabaseUrl : 'http://localhost:54321',
  isSupabaseConfigured ? env.supabaseAnonKey : 'missing-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'max.auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  },
);

export type { Database };
