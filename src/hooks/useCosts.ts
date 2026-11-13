import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/app/providers/PermissionsProvider';
import { useQuery } from './useQuery';
import { useLiveRefetch } from './useRealtime';

interface CostMaps {
  ingredients: Record<string, number>;
  menu_items: Record<string, number>;
  purchase_orders: Record<string, number>;
}

/**
 * Purchase costs are hidden by the database from everyone but the owner (or a 'costs' grant).
 * `allowed` is false for the rest; the getters then return null and screens hide cost columns.
 */
export function useCosts() {
  const { can } = usePermissions();
  const allowed = can('costs');
  const q = useQuery(
    async (): Promise<CostMaps | null> => {
      const { data, error } = await supabase.rpc('cost_data');
      if (error) throw error;
      return (data as unknown as CostMaps | null) ?? null;
    },
    [allowed],
    { enabled: allowed },
  );
  useLiveRefetch(allowed ? ['ingredients', 'menu_items', 'purchase_orders', 'recipe_items'] : [], q.refetch, 800);
  const maps = allowed ? q.data : null;
  const ingredient = useCallback((id: string): number | null => (maps ? Number(maps.ingredients[id] ?? 0) : null), [maps]);
  const menuItem = useCallback((id: string): number | null => (maps ? Number(maps.menu_items[id] ?? 0) : null), [maps]);
  const po = useCallback((id: string): number | null => (maps ? Number(maps.purchase_orders[id] ?? 0) : null), [maps]);
  return { allowed, ready: !allowed || maps != null, ingredient, menuItem, po, refetch: q.refetch };
}
