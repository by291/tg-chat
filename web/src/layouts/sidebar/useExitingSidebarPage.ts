import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';

const SIDEBAR_EXIT_MS = 300;

/** Retain outgoing content for the slide, then release its DOM and subscriptions. */
export function useExitingSidebarPage<Value>(
  value: Value | undefined,
  canDisplay?: (candidate: Value) => boolean,
) {
  const retained = useRef(value);
  const [, release] = useReducer((revision: number) => revision + 1, 0);
  const isPresent = value !== undefined;
  const candidate = isPresent ? value : retained.current;
  const isAllowed = candidate !== undefined && (!canDisplay || canDisplay(candidate));
  const displayed = isAllowed ? candidate : undefined;

  useLayoutEffect(() => {
    // A revoked page must be forgotten before a subsequent render can readmit the same target.
    retained.current = displayed;
  }, [displayed]);
  useEffect(() => {
    if (isPresent || retained.current === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      retained.current = undefined;
      release();
    }, SIDEBAR_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [isPresent]);

  return displayed;
}
