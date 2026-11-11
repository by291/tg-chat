import { useEffect, useState } from 'react';

interface Authorization {
  key?: string;
  authorize?: (signal: AbortSignal) => Promise<string>;
}

/** Keep signed URLs in mounted view state and discard responses after access changes. */
export function useAuthorizedMediaUrl({ key, authorize }: Authorization) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; url?: string; error?: string }>();
  useEffect(() => {
    if (!key || !authorize) {
      return;
    }
    const controller = new AbortController();
    void authorize(controller.signal).then(
      (url) => {
        if (!controller.signal.aborted) {
          setResult({ key, url });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : 'Media unavailable.';
          setResult({ key, error: message });
        }
      },
    );
    return () => controller.abort();
  }, [authorize, key, revision]);

  return {
    url: result?.key === key ? result?.url : undefined,
    error: result?.key === key ? result?.error : undefined,
    renew: () => setRevision((value) => value + 1),
  };
}
