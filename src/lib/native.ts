// Bridge to the MAX Management phone apps (Android / iOS). A WebView there cannot print or download
// on its own, so the page hands the work to the app. In a normal browser these return false and do nothing.

interface AndroidBridge {
  print(html: string, title: string): void;
  saveFile(name: string, mime: string, base64: string): void;
}
interface IosHandlers {
  maxPrint?: { postMessage(m: unknown): void };
  maxSave?: { postMessage(m: unknown): void };
}

const android = (): AndroidBridge | undefined => (window as unknown as { MaxNative?: AndroidBridge }).MaxNative;
const ios = (): IosHandlers | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: IosHandlers } }).webkit?.messageHandlers;

export function isNativeApp(): boolean {
  return Boolean(android() || ios()?.maxPrint);
}

/** Print a complete HTML document through the app. */
export function nativePrint(html: string, title: string): boolean {
  const a = android();
  if (a) {
    a.print(html, title);
    return true;
  }
  const h = ios()?.maxPrint;
  if (h) {
    h.postMessage({ html, title });
    return true;
  }
  return false;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Save / share a text file (CSV) through the app. */
export function nativeSave(name: string, mime: string, text: string): boolean {
  const a = android();
  if (a) {
    a.saveFile(name, mime, toBase64(text));
    return true;
  }
  const h = ios()?.maxSave;
  if (h) {
    h.postMessage({ name, mime, base64: toBase64(text) });
    return true;
  }
  return false;
}
