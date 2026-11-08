import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

const DeferredMediaContext = createContext(false);

/** Keep newly mounted media idle until history navigation has settled. */
export function DeferredMessageMedia({
  isDeferred,
  children,
}: {
  isDeferred: boolean;
  children: ReactNode;
}) {
  return <DeferredMediaContext value={isDeferred}>{children}</DeferredMediaContext>;
}

/** Defer new image sources while retaining media already displayed before the animation. */
export function useDeferredMediaSource(source?: string) {
  const isDeferred = useContext(DeferredMediaContext);
  const displayedSourceRef = useRef(isDeferred ? undefined : source);

  useEffect(() => {
    if (!isDeferred) {
      displayedSourceRef.current = source;
    }
  }, [isDeferred, source]);

  // Do not blank existing pictures when a jump begins. New rows reserve their normal geometry,
  // but start fetching and decoding only after the temporary navigation range is released.
  if (isDeferred && displayedSourceRef.current !== source) {
    return undefined;
  }
  return source;
}
