import { useCallback, useEffect, useState } from 'react';
import { MissingAssetError, type Memo } from '@/services/staticData';

export type ResourceStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface ResourceState<T> {
  status: ResourceStatus;
  data: T | undefined;
  error: Error | null;
  retry(): void;
}

/**
 * Subscribe a component to a memoised loader. Returns synchronously with `ready` when the value is
 * already cached (no skeleton flash on route changes). `missing` = the artifact has not been produced
 * yet (friendly empty state); `error` = anything else.
 */
export function useResource<T>(memo: Memo<T>): ResourceState<T> {
  const cached = memo.peek();
  const [state, setState] = useState<Omit<ResourceState<T>, 'retry'>>(() =>
    cached !== undefined
      ? { status: 'ready', data: cached, error: null }
      : { status: 'loading', data: undefined, error: null },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    if (memo.peek() !== undefined) {
      setState({ status: 'ready', data: memo.peek(), error: null });
      return;
    }
    setState((s) => (s.status === 'loading' ? s : { status: 'loading', data: undefined, error: null }));
    memo.get().then(
      (data) => alive && setState({ status: 'ready', data, error: null }),
      (error: unknown) => {
        if (!alive) return;
        const err = error instanceof Error ? error : new Error(String(error));
        setState({ status: err instanceof MissingAssetError ? 'missing' : 'error', data: undefined, error: err });
      },
    );
    return () => {
      alive = false;
    };
  }, [memo, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}
