// Public defaults for the MAX production project (both values are public by design — the anon key is
// protected by Row Level Security). Override with VITE_* env vars to point at another project.
const DEFAULT_SUPABASE_URL = 'https://yjytosfsktwrzsthlfji.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqeXRvc2Zza3R3cnpzdGhsZmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0OTg1NzksImV4cCI6MjExMDA3NDU3OX0.lk54l-_3tSd7BpRX0h9E-ddg8ygC6190w_0Nv2k1pmk';

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL).replace(/\/$/, '');

export const env = {
  supabaseUrl,
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_ANON_KEY,
  // Image uploads go through the `images` Edge Function (or a Cloudflare Worker with the same API).
  r2WorkerUrl: ((import.meta.env.VITE_R2_WORKER_URL as string | undefined) || (supabaseUrl ? `${supabaseUrl}/functions/v1/images` : '')).replace(/\/$/, ''),
  r2PublicUrl: ((import.meta.env.VITE_R2_PUBLIC_URL as string | undefined) || 'https://pub-1400032e0dba4fcbac4eb18a30180e40.r2.dev').replace(/\/$/, ''),
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
