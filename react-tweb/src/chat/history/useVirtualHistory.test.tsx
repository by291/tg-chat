// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import { createHistoryRows } from './historyRows';
import type { MessageNavigation } from './MessageTimeline';
import { useVirtualHistory } from './useVirtualHistory';

const VIEWPORT_WIDTH = 696;
const VIEWPORT_HEIGHT = 400;
const ROW_HEIGHT = 80.5;
const rows = createHistoryRows(createHistoryMessages().slice(0, 100));

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => VIEWPORT_WIDTH,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => Math.round(ROW_HEIGHT),
  });
  Element.prototype.getBoundingClientRect = function () {
    return DOMRect.fromRect({ width: VIEWPORT_WIDTH, height: ROW_HEIGHT });
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      const canvas = this.firstElementChild as HTMLElement | null;
      return Number.parseFloat(canvas?.style.height || '0');
    },
  });
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (!options || typeof options === 'number') {
      return;
    }
    this.scrollTop = Math.max(0, options.top || 0);
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  };
});

afterEach(cleanup);

function HistoryScreen({ navigation }: { navigation?: MessageNavigation }) {
  const scroll = useVirtualHistory({ rows, navigation, hasOlder: false, loadOlder: () => {} });
  return (
    <div ref={scroll.viewportRef} onScroll={scroll.updateScrollPosition}>
      <div style={{ height: scroll.virtualizer.getTotalSize() }}>
        {scroll.virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={scroll.virtualizer.measureElement}
            style={{ position: 'absolute', top: item.start }}
          >
            {String(item.key)}
          </div>
        ))}
      </div>
    </div>
  );
}

async function settleInitialFrame() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

describe('initial virtual positioning', () => {
  it('positions adjacent rows without rounding their fractional heights', async () => {
    render(<HistoryScreen />);
    await settleInitialFrame();

    const previousRow = await screen.findByText('lab-history-99');
    const lastRow = screen.getByText('lab-history-100');
    const distance =
      Number.parseFloat(lastRow.style.top) - Number.parseFloat(previousRow.style.top);

    expect(distance).toBe(previousRow.getBoundingClientRect().height);
  });

  it('keeps an initial reply navigation instead of overwriting it with a bottom jump', async () => {
    render(<HistoryScreen navigation={{ messageId: 'lab-history-12', requestId: 1 }} />);
    await settleInitialFrame();
    await waitFor(() => expect(screen.getByText('lab-history-12')).toBeTruthy());
    expect(screen.queryByText('lab-history-100')).toBeNull();
  });

  it('opens the latest history under Strict Mode effect remounting', async () => {
    render(
      <StrictMode>
        <HistoryScreen />
      </StrictMode>,
    );
    await settleInitialFrame();
    await waitFor(() => expect(screen.getByText('lab-history-100')).toBeTruthy());
    expect(screen.queryByText('lab-history-1')).toBeNull();
  });
});
