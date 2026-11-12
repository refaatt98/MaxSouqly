import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Global keyboard shortcuts. Keys are KeyboardEvent.key values, optionally prefixed with "mod+" (Ctrl/⌘).
 * Function keys and "mod+" combos work while typing; plain keys are ignored inside inputs unless listed in `allowInInputs`.
 */
export function useHotkeys(map: HotkeyMap, enabled = true, allowInInputs: string[] = []): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') && !allowInInputs.includes('__dialogs__')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = (mod ? 'mod+' : '') + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const handler = ref.current[key];
      if (!handler) return;
      const fnKey = /^F\d+$/.test(e.key);
      if (isTyping(e.target) && !mod && !fnKey && !allowInInputs.includes(e.key)) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, allowInInputs]);
}
