// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePollResultAnimation } from './usePollResultAnimation';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('settles both the number and bar when a new result interrupts at the current number', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const view = renderHook(
    ({ percentage }) => usePollResultAnimation({ hasResults: true, percentage }),
    { initialProps: { percentage: 0 } },
  );
  view.rerender({ percentage: 100 });
  act(() => vi.advanceTimersByTime(144));
  expect(view.result.current.percentage).toBe(16);
  expect(view.result.current.progress).toBeCloseTo(0.24);

  view.rerender({ percentage: 16 });
  act(() => vi.advanceTimersByTime(1000));
  expect(view.result.current.percentage).toBe(16);
  expect(view.result.current.progress).toBeCloseTo(0.16);
  view.unmount();
});
