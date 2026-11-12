import { useCallback, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT, type TranslationKey } from '@/i18n';
import { compressToWebp, deleteImage, uploadImage, UploadError, validateImage, type UploadFolder } from '@/lib/r2';

/**
 * Tracks an image URL in a form. The previous object is deleted only after the form is saved
 * (`commit`), and a freshly uploaded object is deleted if the form is discarded (`discard`).
 */
export function useImageField(initial: string | null) {
  const [url, setUrlState] = useState<string | null>(initial);
  const original = useRef(initial);
  const uploaded = useRef<Set<string>>(new Set());
  const setUrl = useCallback((next: string | null) => {
    if (next) uploaded.current.add(next);
    setUrlState(next);
  }, []);
  const reset = useCallback((next: string | null) => {
    original.current = next;
    uploaded.current = new Set();
    setUrlState(next);
  }, []);
  /** Call after a successful save: removes the replaced object and unused uploads. */
  const commit = useCallback(async () => {
    const stale = [...uploaded.current].filter((u) => u !== url);
    if (original.current && original.current !== url) stale.push(original.current);
    original.current = url;
    uploaded.current = new Set();
    await Promise.all(stale.map((u) => deleteImage(u)));
  }, [url]);
  /** Call when the form is cancelled: removes everything uploaded during this session. */
  const discard = useCallback(async () => {
    const fresh = [...uploaded.current].filter((u) => u !== original.current);
    uploaded.current = new Set();
    setUrlState(original.current);
    await Promise.all(fresh.map((u) => deleteImage(u)));
  }, []);
  return { url, setUrl, reset, commit, discard };
}

export function ImageUploader({ value, onChange, folder, label, shape = 'square', className }: {
  value: string | null;
  onChange: (url: string | null) => void;
  folder: UploadFolder;
  label?: string;
  shape?: 'square' | 'circle';
  className?: string;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      validateImage(file);
      const blob = await compressToWebp(file);
      const local = URL.createObjectURL(blob);
      setPreview(local);
      setProgress(0);
      const url = await uploadImage(blob, folder, setProgress);
      onChange(url);
      URL.revokeObjectURL(local);
      setPreview(null);
    } catch (err) {
      const code = err instanceof UploadError ? err.code : 'UPLOAD_FAILED';
      setError(t(`errors.${code}` as TranslationKey));
      setPreview(null);
    } finally {
      setProgress(null);
    }
  };

  const shown = preview ?? value;
  const round = shape === 'circle' ? 'rounded-full' : 'rounded-card';

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <p className="text-sm font-medium text-fg-2">{label}</p>}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void handle(e.dataTransfer.files[0]);
          }}
          className={cn(
            'relative grid size-28 shrink-0 place-items-center overflow-hidden border-2 border-dashed transition-colors',
            round,
            drag ? 'border-brand bg-brand/10' : 'border-line-strong bg-surface hover:border-fg-3',
          )}
          aria-label={t('upload.drop')}
        >
          {shown ? <img src={shown} alt="" className="size-full object-contain p-1" /> : <ImagePlus className="size-8 text-fg-3" />}
          {progress !== null && (
            <span className="absolute inset-0 grid place-items-center bg-black/60 text-xs font-bold">
              <LoaderCircle className="mb-1 size-5 animate-spin" />
              {t('upload.uploading', { progress })}
            </span>
          )}
        </button>
        <div className="min-w-0 space-y-2 text-sm">
          <p className="text-fg-2">{t('upload.drop')}</p>
          <p className="text-xs text-fg-3">{t('upload.formats')}</p>
          {value && (
            <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-danger hover:underline">
              <Trash className="size-3.5" /> {t('upload.remove')}
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
