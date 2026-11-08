import { useLayoutEffect, useRef } from 'react';

/** Retain the last content while Ark keeps a closing dialog mounted for its exit animation. */
export function useClosingDialogValue<Value>(value: Value | undefined): Value | undefined {
  const lastValue = useRef(value);

  useLayoutEffect(() => {
    if (value !== undefined) {
      lastValue.current = value;
    }
  }, [value]);

  return value ?? lastValue.current;
}
