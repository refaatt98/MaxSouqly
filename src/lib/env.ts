export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  r2WorkerUrl: ((import.meta.env.VITE_R2_WORKER_URL as string | undefined) ?? '').replace(/\/$/, ''),
  r2PublicUrl: ((import.meta.env.VITE_R2_PUBLIC_URL as string | undefined) ?? '').replace(/\/$/, ''),
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
