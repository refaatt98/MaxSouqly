import { useEffect, useRef } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/env';
import type { Database } from '@/types/database';

type TableName = keyof Database['public']['Tables'];
type Row<T extends TableName> = Database['public']['Tables'][T]['Row'];

export interface RealtimeSpec<T extends TableName> {
  table: T;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
}

let channelSeq = 0;

/**
 * Typed postgres_changes subscription. Cleans up on unmount; supabase-js reconnects automatically.
 * `onChange` is kept in a ref so callers don't need to memoize it.
 */
export function useRealtime<T extends TableName>(
  spec: RealtimeSpec<T> | null,
  onChange: (payload: RealtimePostgresChangesPayload<Row<T>>) => void,
): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const table = spec?.table;
  const event = spec?.event ?? '*';
  const filter = spec?.filter;

  useEffect(() => {
    if (!table || !isSupabaseConfigured) return;
    const name = `rt:${table}:${filter ?? 'all'}:${++channelSeq}`;
    const channel = supabase
      .channel(name)
      .on(
        'postgres_changes' as never,
        { event, schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<Row<T>>) => cb.current(payload),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, event, filter]);
}
