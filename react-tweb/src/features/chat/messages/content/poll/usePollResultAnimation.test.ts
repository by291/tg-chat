// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePollResultAnimation } from './usePollResultAnimation';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('settles both the number and bar when a new result interrupts at the current number', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const view = renderHook(
    ({ percentage }) => usePollResultAnimation({ hasResults: true, percentage }),
    { initialProps: { percentage: 0 } },
  );
  view.rerender({ percentage: 100 });
  await waitFor(() => expect(view.result.current.percentage.get()).toBeGreaterThan(0));
  const interruptedPercentage = view.result.current.percentage.get();
  expect(view.result.current.progress.get()).toBeGreaterThan(interruptedPercentage / 100);

  view.rerender({ percentage: interruptedPercentage });
  await waitFor(() => {
    expect(view.result.current.percentage.get()).toBe(interruptedPercentage);
    expect(view.result.current.progress.get()).toBeCloseTo(interruptedPercentage / 100);
  });
  view.unmount();
});

it('resets an interrupted reveal when results become hidden', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const view = renderHook(usePollResultAnimation, {
    initialProps: { hasResults: true, percentage: 0 },
  });
  view.rerender({ hasResults: true, percentage: 100 });
  await waitFor(() => expect(view.result.current.percentage.get()).toBeGreaterThan(0));
  view.rerender({ hasResults: false, percentage: 0 });
  expect(view.result.current.stage).toBe('choice');
  expect(view.result.current.percentage.get()).toBe(0);
  expect(view.result.current.progress.get()).toBe(0);

  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(view.result.current.percentage.get()).toBe(0);
});
