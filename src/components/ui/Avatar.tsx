import { cn } from '@/lib/cn';

const palette = ['bg-brand/25 text-[#ff7a85]', 'bg-info/25 text-[#8fb2ff]', 'bg-gold/20 text-gold', 'bg-success/20 text-success', 'bg-warning/20 text-warning'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, url, size = 'md', className }: { name: string; url?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const dims = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' }[size];
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
  if (url) {
    return <img src={url} alt={name} className={cn('shrink-0 rounded-full object-cover ring-1 ring-line-strong', dims, className)} loading="lazy" />;
  }
  return (
    <span aria-label={name} className={cn('grid shrink-0 place-items-center rounded-full font-bold ring-1 ring-line-strong', dims, palette[hash(name) % palette.length], className)}>
      {initials || '?'}
    </span>
  );
}
