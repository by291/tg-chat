import { useLayoutEffect, useRef } from 'react';
import { downloadMedia } from './mediaAccess';

/** Start an original download only while its clicked occurrence still owns the signature. */
export function useOriginalDownload(options: {
  authorize?: (signal: AbortSignal) => Promise<string>;
  onError: (message: string) => void;
}) {
  const { authorize, onError } = options;
  const request = useRef<AbortController>(undefined);
  useLayoutEffect(() => () => request.current?.abort(), [authorize]);

  return () => {
    if (!authorize) {
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;

    // Revocation or a replacement click can arrive after signing but before navigation.
    void authorize(controller.signal).then(
      (url) => {
        if (!controller.signal.aborted) {
          downloadMedia(url);
        }
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          onError(failure instanceof Error ? failure.message : 'Download unavailable.');
        }
      },
    );
  };
}
