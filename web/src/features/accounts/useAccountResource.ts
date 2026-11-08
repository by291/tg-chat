import { useEffect, useState } from 'react';
import { ApiError, isCancelled } from '../auth/SessionOwner';

/** Discard page-owned results after unmount and expose explicit reload after committed writes. */
export function useAccountResource<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T>();
  const [resolvedLoader, setResolvedLoader] = useState(() => load);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError('');
    // Preserve mounted forms on a same-page reload; a new directory scope must start empty.
    if (resolvedLoader !== load) {
      setValue(undefined);
      setResolvedLoader(() => load);
    }
    void load()
      .then((result) => {
        if (isCurrent) {
          setValue(result);
        }
      })
      .catch((failure: unknown) => {
        if (isCurrent && !isCancelled(failure)) {
          setError(
            failure instanceof ApiError ? failure.message : 'Could not load this account page.',
          );
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [load, revision]);

  return {
    value: resolvedLoader === load ? value : undefined,
    error: resolvedLoader === load ? error : '',
    isLoading: resolvedLoader !== load || isLoading,
    reload: () => setRevision((current) => current + 1),
  };
}
