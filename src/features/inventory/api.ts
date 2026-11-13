import { supabase } from '@/lib/supabase';
import { INGREDIENT_COLS } from '@/lib/columns';
import type { Tone } from '@/components/ui/Badge';
import type { Ingredient, Supplier, UnitType } from '@/types/models';

export async function fetchIngredients(): Promise<Ingredient[]> {
  const { data, error } = await supabase.from('ingredients').select(INGREDIENT_COLS).order('name_ar');
  if (error) throw error;
  return data;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from('suppliers').select('*').order('name');
  if (error) throw error;
  return data;
}

export type StockLevel = 'ok' | 'low' | 'out';

export function stockLevel(i: Pick<Ingredient, 'quantity' | 'min_quantity'>): StockLevel {
  const q = Number(i.quantity);
  if (q <= 0) return 'out';
  if (q <= Number(i.min_quantity)) return 'low';
  return 'ok';
}

export const LEVEL_TONE: Record<StockLevel, Tone> = { ok: 'green', low: 'red', out: 'red' };


/** Mirrors public.unit_factor() in the database. Returns null for incompatible units. */
export function unitFactor(from: UnitType, to: UnitType): number | null {
  if (from === to) return 1;
  if (from === 'g' && to === 'kg') return 0.001;
  if (from === 'kg' && to === 'g') return 1000;
  if (from === 'ml' && to === 'l') return 0.001;
  if (from === 'l' && to === 'ml') return 1000;
  return null;
}

export function compatibleUnits(base: UnitType): UnitType[] {
  if (base === 'kg' || base === 'g') return ['kg', 'g'];
  if (base === 'l' || base === 'ml') return ['l', 'ml'];
  return [base];
}

/** Recipes are usually written in grams / millilitres. */
export function defaultRecipeUnit(base: UnitType): UnitType {
  return base === 'kg' ? 'g' : base === 'l' ? 'ml' : base;
}
