import type { Tone } from '@/components/ui/Badge';
import type { OrderStatus, PaymentMethod } from '@/types/models';

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  new: 'red',
  preparing: 'amber',
  ready: 'green',
  served: 'neutral',
  cancelled: 'red',
  refunded: 'gold',
};

export function paymentKind(methods: PaymentMethod[]): 'cash' | 'card' | 'mixed' | null {
  const set = new Set(methods);
  if (set.size === 0) return null;
  if (set.size > 1) return 'mixed';
  return methods[0];
}
