// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StickyDateHeaders } from './StickyDateHeaders';
import type { HistoryDateGroup } from './historyDates';

const FRAME_DURATION = 16;
const IDLE_DELAY = 1350;
const GROUP: HistoryDateGroup = {
  date: {
    kind: 'date',
    key: 'day-one',
    label: 'November 3',
    timestamp: new Date(2026, 10, 3).getTime(),
  },
  start: 0,
  end: 800,
  firstRowIndex: 0,
  lastRowIndex: 10,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('preserves the header and idle deadline when paging changes measured coordinates', () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), FRAME_DURATION);
  });
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
  const viewportRef = createRef<HTMLDivElement>();

  function renderHistory(group: HistoryDateGroup) {
    return (
      <div ref={viewportRef}>
        <StickyDateHeaders
          groups={[group]}
          viewportRef={viewportRef}
          topInset={0}
          isPreview={false}
          onOpenDate={() => {}}
        />
      </div>
    );
  }

  const view = render(renderHistory(GROUP));
  const viewport = viewportRef.current!;
  Object.defineProperty(viewport, 'scrollHeight', { value: 1000 });
  Object.defineProperty(viewport, 'clientHeight', { value: 200 });
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  act(() => vi.advanceTimersByTime(FRAME_DURATION));

  const button = view.getByRole('button', { name: 'Jump to date: November 3' });
  expect(button.parentElement?.dataset.hidden).toBe('false');
  act(() => vi.advanceTimersByTime(IDLE_DELAY / 2));

  // Older messages shift both the group and the reading anchor by the same distance.
  const prependedHeight = 300;
  viewport.scrollTop += prependedHeight;
  view.rerender(
    renderHistory({
      ...GROUP,
      start: GROUP.start + prependedHeight,
      end: GROUP.end + prependedHeight,
    }),
  );
  expect(view.getByRole('button', { name: 'Jump to date: November 3' })).toBe(button);
  expect(button.parentElement?.dataset.hidden).toBe('false');

  act(() => vi.advanceTimersByTime(IDLE_DELAY / 2));
  expect(button.parentElement?.dataset.hidden).toBe('true');
});
