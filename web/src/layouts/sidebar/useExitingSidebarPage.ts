import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';

const SIDEBAR_EXIT_MS = 300;

/** Retain outgoing content for the slide, then release its DOM and subscriptions. */
export function useExitingSidebarPage<Value>(value: Value | undefined) {
  const retained = useRef(value);
  const [, release] = useReducer((revision: number) => revision + 1, 0);
  const isPresent = value !== undefined;
  useLayoutEffect(() => {
    if (value !== undefined) {
      retained.current = value;
    }
  }, [value]);
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

  return value ?? retained.current;
}
