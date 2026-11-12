// Web Audio chime (no library, no audio files).
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Must be called from a user gesture once, so browsers allow later playback. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume();
  return c.state === 'running';
}

export function audioUnlocked(): boolean {
  return ctx?.state === 'running';
}

function tone(c: AudioContext, freq: number, start: number, duration: number, gain = 0.18) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Bright three-note chime for new orders. */
export function playChime(): void {
  const c = context();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  tone(c, 880, t, 0.35);
  tone(c, 1174.66, t + 0.12, 0.35);
  tone(c, 1567.98, t + 0.24, 0.6);
}

/** Short confirmation blip (payment success). */
export function playSuccess(): void {
  const c = context();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  tone(c, 660, t, 0.18, 0.12);
  tone(c, 990, t + 0.09, 0.3, 0.12);
}
