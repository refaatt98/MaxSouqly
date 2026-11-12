import { useState } from 'react';
import { Utensils } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Food photo on a calm surface — the food carries the color. */
export function FoodImage({ src, alt, className, imgClassName }: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  imgClassName?: string;
  glow?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn('relative grid place-items-center overflow-hidden', className)}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className={cn('relative size-full object-contain', imgClassName)}
        />
      ) : (
        <Utensils className="relative size-1/3 text-fg-3" aria-hidden />
      )}
    </div>
  );
}
