import { cn } from '@/lib/cn';

/** MAX wordmark with the red slash accent. */
export function BrandMark({ size = 'md', withSlogan = false, className }: { size?: 'sm' | 'md' | 'lg' | 'xl'; withSlogan?: boolean; className?: string }) {
  const text = { sm: 'text-xl', md: 'text-2xl', lg: 'text-4xl', xl: 'text-7xl' }[size];
  const slash = { sm: 'h-5 w-1.5', md: 'h-6 w-2', lg: 'h-9 w-2.5', xl: 'h-16 w-4' }[size];
  return (
    <div className={cn('flex flex-col', className)} dir="ltr">
      <div className={cn('flex items-center gap-2 font-black tracking-tight text-fg', text)}>
        <span className={cn('inline-block -skew-x-12 rounded-sm bg-brand shadow-glow-sm', slash)} aria-hidden />
        <span>MAX</span>
      </div>
      {withSlogan && (
        <span className={cn('mt-1 font-medium whitespace-nowrap text-fg-3 uppercase', size === 'xl' || size === 'lg' ? 'text-xs tracking-[0.2em]' : 'text-[10px] tracking-[0.12em]')}>
          Good Food Good Mood
        </span>
      )}
    </div>
  );
}
