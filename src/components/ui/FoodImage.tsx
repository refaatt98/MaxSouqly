import { useState } from 'react';
import { Utensils } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Food photo with the signature radial glow behind it. */
export function FoodImage({ src, alt, className, glow = true, imgClassName }: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  imgClassName?: string;
  glow?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn('relative grid place-items-center overflow-hidden', className)}>
      {glow && (
        <div
          aria-hidden
          className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_50%_55%,rgb(225_29_46/0.35),rgb(245_179_1/0.08)_45%,transparent_70%)] blur-md"
        />
      )}
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className={cn('relative size-full object-contain drop-shadow-[0_12px_18px_rgb(0_0_0/0.55)]', imgClassName)}
        />
      ) : (
        <Utensils className="relative size-1/3 text-fg-3" aria-hidden />
      )}
    </div>
  );
}
