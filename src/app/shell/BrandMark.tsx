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
      {withSlogan && <span className="mt-1 text-xs font-medium tracking-[0.2em] text-fg-3 uppercase">Good Food Good Mood</span>}
    </div>
  );
}
