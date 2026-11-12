import { useEffect, useRef } from 'react';

/**
 * Detects barcode-scanner input (fast digit bursts ending with Enter) anywhere on the page,
 * except inside text fields (the search box handles its own Enter).
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const now = performance.now();
      if (now - last > 60) buffer = '';
      last = now;
      if (/^[0-9A-Za-z]$/.test(e.key)) buffer += e.key;
      else if (e.key === 'Enter' && buffer.length >= 6) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cb.current(buffer);
        buffer = '';
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
