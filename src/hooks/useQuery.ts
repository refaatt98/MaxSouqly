import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refetch: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Small data-fetching hook: loading / error / data states, race-safe refetch,
 * and `setData` for optimistic updates. Background refetches keep showing old data.
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: DependencyList, opts: { enabled?: boolean } = {}): QueryState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const reqId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setLoading((prev) => prev || data === undefined);
    try {
      const result = await fetcherRef.current();
      if (id === reqId.current) {
        setDataState(result);
        setError(null);
      }
    } catch (err) {
      if (id === reqId.current) setError(err);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  return { data, error, loading, refetch: run, setData };
}

/** Wraps a mutation with a pending flag. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mutate = useCallback(async (...args: A): Promise<R> => {
    setPending(true);
    try {
      return await fnRef.current(...args);
    } finally {
      setPending(false);
    }
  }, []);
  return { mutate, pending };
}
