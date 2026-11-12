import { cn } from '@/lib/cn';

/** MAX wordmark with the red slash accent. */
export function BrandMark({ size = 'md', withSlogan = false, className }: { size?: 'sm' | 'md' | 'lg' | 'xl'; withSlogan?: boolean; className?: string }) {
  const text = { sm: 'text-lg', md: 'text-xl', lg: 'text-3xl', xl: 'text-6xl' }[size];
  const slash = { sm: 'h-4 w-1', md: 'h-5 w-1.5', lg: 'h-7 w-2', xl: 'h-12 w-3' }[size];
  return (
    <div className={cn('flex flex-col', className)} dir="ltr">
      <div className={cn('flex items-center gap-2 leading-none font-semibold text-fg', text)}>
        <span className={cn('inline-block -skew-x-12 rounded-[2px] bg-brand', slash)} aria-hidden />
        <span>MAX</span>
      </div>
      {withSlogan && (
        <span className={cn('mt-1.5 whitespace-nowrap text-fg-3', size === 'xl' || size === 'lg' ? 'text-sm' : 'text-xs')}>Good Food Good Mood</span>
      )}
    </div>
  );
}
