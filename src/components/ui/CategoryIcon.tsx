import { Coffee, CupSoda, Flame, Hamburger, IceCreamCone, Pizza, Popcorn, Salad, Sandwich, Utensils, Cake, Soup, type LucideIcon } from 'lucide-react';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  burger: Hamburger,
  pizza: Pizza,
  flame: Flame,
  drink: CupSoda,
  coffee: Coffee,
  dessert: IceCreamCone,
  cake: Cake,
  fries: Popcorn,
  salad: Salad,
  sandwich: Sandwich,
  soup: Soup,
  utensils: Utensils,
};

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = CATEGORY_ICONS[icon] ?? Utensils;
  return <Icon className={className} aria-hidden />;
}
