// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import { createHistoryRows } from './historyRows';
import type { MessageNavigation } from './MessageTimeline';
import { useVirtualHistory } from './useVirtualHistory';
import type { HistoryRow } from './historyRows';
import { CURRENT_USER_ID } from '@/domain/identity';
import type { ChatOverlayInsets } from '../useChatOverlayInsets';
import type { RemoteHistory } from './useHistoryWindow';

const VIEWPORT_WIDTH = 696;
const VIEWPORT_HEIGHT = 400;
const ROW_HEIGHT = 80.5;
const HISTORY_MESSAGE_COUNT = 100;
const SHORT_HISTORY_MESSAGE_COUNT = 2;
const FRAME_DURATION_MS = 16;
const ANIMATION_SAMPLE_DELAY_MS = 80;
const LATE_REVEAL_DELAY_MS = 210;
const ANIMATION_SETTLE_DELAY_MS = 650;
const READING_SCROLL_DISTANCE = 600;
const INTERRUPTION_SCROLL_DISTANCE = 240;
const REPLY_OVERLAY_INSETS = { top: 50, bottom: 240 };
const COMPOSER_OVERLAY_INSETS = { top: 50, bottom: 80 };
const rows = createHistoryRows(createHistoryMessages().slice(0, HISTORY_MESSAGE_COUNT));

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

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'Date',
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface HistoryScreenProps {
  navigation?: MessageNavigation;
  historyRows?: HistoryRow[];
  overlayInsets?: ChatOverlayInsets;
  remoteHistory?: RemoteHistory;
  onReachLatest?: (messageId: string) => void;
  onReachMessage?: (messageId: string) => void;
}

function HistoryScreen({
  navigation,
  historyRows = rows,
  overlayInsets,
  remoteHistory,
  onReachLatest,
  onReachMessage,
}: HistoryScreenProps) {
  const scroll = useVirtualHistory({
    rows: historyRows,
    navigation,
    overlayInsets,
    hasOlder: false,
    loadOlder: () => {},
    remoteHistory,
    onReachLatest,
    onReachMessage,
  });
  const totalHeight = scroll.virtualizer.getTotalSize();
  const bottomAlignment = Math.max(0, VIEWPORT_HEIGHT - totalHeight);

  return (
    <>
      <button onClick={scroll.jumpToLatest}>Latest</button>
      <div
        ref={scroll.viewportRef}
        aria-label="Message history"
        onScroll={scroll.updateScrollPosition}
        onWheel={scroll.cancelAutomaticScroll}
      >
        <div
          ref={(element) => {
            scroll.contentRef.current = element;
            const viewport = element?.parentElement;
            if (viewport) {
              // Browsers clamp the scroll offset as soon as a shorter canvas commits.
              const maximumOffset = Math.max(0, totalHeight + bottomAlignment - VIEWPORT_HEIGHT);
              viewport.scrollTop = Math.min(viewport.scrollTop, maximumOffset);
            }
          }}
          style={{ height: totalHeight + bottomAlignment }}
        >
          <div ref={scroll.animatedRowsRef} data-testid="animated-rows">
            {scroll.virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={scroll.virtualizer.measureElement}
                style={{ position: 'absolute', top: item.start + bottomAlignment }}
              >
                {String(item.key)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

async function settleInitialFrame() {
  await advanceAnimation(FRAME_DURATION_MS);
  await advanceAnimation(FRAME_DURATION_MS);
}

function appendMessage({ authorId }: { authorId: string }) {
  const messages = createHistoryMessages().slice(0, HISTORY_MESSAGE_COUNT);
  const lastMessage = messages[messages.length - 1];
  return createHistoryRows([
    ...messages,
    {
      ...lastMessage,
      id: 'new-message',
      authorId,
    },
  ]);
}

async function advanceAnimation(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function createPendingHistoryRequest() {
  let complete!: () => void;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, complete };
}

describe('bounded remote history', () => {
  const remoteHistory: RemoteHistory = {
    hasOlder: false,
    hasNewer: true,
    isLoading: false,
    loadOlder: () => {},
  };

  it('requests newer history once at the current boundary as the user scrolls down', async () => {
    const loadNewer = vi.fn();
    render(
      <HistoryScreen
        navigation={{ messageId: 'lab-history-12', requestId: 1 }}
        remoteHistory={{ ...remoteHistory, loadNewer }}
      />,
    );
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(loadNewer).not.toHaveBeenCalled();

    const viewport = screen.getByLabelText('Message history');
    fireEvent.wheel(viewport);
    act(() => viewport.scrollTo({ top: viewport.scrollHeight - viewport.clientHeight }));
    await settleInitialFrame();
    fireEvent.scroll(viewport);
    await settleInitialFrame();

    expect(loadNewer).toHaveBeenCalledTimes(1);
  });

  it('preserves position when the final newer page arrives at the loaded bottom', async () => {
    const view = render(<HistoryScreen remoteHistory={remoteHistory} />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    fireEvent.wheel(viewport);
    await settleInitialFrame();
    const readingOffset = viewport.scrollTop;

    view.rerender(
      <HistoryScreen
        historyRows={appendMessage({ authorId: 'alex' })}
        remoteHistory={{ ...remoteHistory, hasNewer: false }}
      />,
    );
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);

    expect(viewport.scrollTop).toBeCloseTo(readingOffset, 0);
  });

  it('waits for the latest remote window before scrolling to its real bottom', async () => {
    const { promise, complete } = createPendingHistoryRequest();
    const jumpToLatest = vi.fn(() => promise);
    const view = render(<HistoryScreen remoteHistory={{ ...remoteHistory, jumpToLatest }} />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));

    expect(jumpToLatest).toHaveBeenCalledTimes(1);
    view.rerender(
      <HistoryScreen
        historyRows={appendMessage({ authorId: 'alex' })}
        remoteHistory={{ ...remoteHistory, hasNewer: false }}
      />,
    );
    await act(async () => complete());
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);

    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });

  it('keeps a newer reply jump when a previous latest request resolves', async () => {
    const { promise, complete } = createPendingHistoryRequest();
    const jumpToLatest = () => promise;
    const view = render(<HistoryScreen remoteHistory={{ ...remoteHistory, jumpToLatest }} />);
    await settleInitialFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    view.rerender(
      <HistoryScreen
        navigation={{ messageId: 'lab-history-12', requestId: 1 }}
        remoteHistory={{ ...remoteHistory, hasNewer: false }}
      />,
    );
    await act(async () => complete());
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);

    const viewport = screen.getByLabelText('Message history');
    const target = screen.getByText('lab-history-12');
    const targetTop = Number.parseFloat(target.style.top) - viewport.scrollTop;
    expect(targetTop).toBeGreaterThanOrEqual(0);
    expect(targetTop).toBeLessThan(viewport.clientHeight);
  });

  it('reports visible incoming messages without marking a middle window as latest', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const onReachLatest = vi.fn();
    const onReachMessage = vi.fn();
    render(
      <HistoryScreen
        historyRows={appendMessage({ authorId: 'alex' })}
        remoteHistory={remoteHistory}
        overlayInsets={COMPOSER_OVERLAY_INSETS}
        onReachLatest={onReachLatest}
        onReachMessage={onReachMessage}
      />,
    );
    await settleInitialFrame();

    expect(onReachMessage).toHaveBeenLastCalledWith('new-message');
    expect(onReachLatest).not.toHaveBeenCalled();
  });
});

describe('initial virtual positioning', () => {
  it('opens an unread divider below the sticky date and top overlay', async () => {
    const messages = createHistoryMessages().slice(0, HISTORY_MESSAGE_COUNT);
    const firstUnreadMessageId = 'lab-history-12';
    render(
      <HistoryScreen
        historyRows={createHistoryRows(messages, { firstUnreadMessageId })}
        navigation={{ messageId: firstUnreadMessageId, requestId: 1, kind: 'unread' }}
        overlayInsets={COMPOSER_OVERLAY_INSETS}
      />,
    );
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);

    const viewport = screen.getByLabelText('Message history');
    const divider = screen.getByText('unread-lab-history-12');
    const dividerTop = Number.parseFloat(divider.style.top) - viewport.scrollTop;
    const expectedDividerTop = COMPOSER_OVERLAY_INSETS.top + 36;
    expect(dividerTop).toBeCloseTo(expectedDividerTop, 0);
  });

  it('positions adjacent rows without rounding their fractional heights', async () => {
    render(<HistoryScreen />);
    await settleInitialFrame();

    const previousRow = screen.getByText('lab-history-99');
    const lastRow = screen.getByText('lab-history-100');
    const distance =
      Number.parseFloat(lastRow.style.top) - Number.parseFloat(previousRow.style.top);

    expect(distance).toBe(previousRow.getBoundingClientRect().height);
  });

  it('keeps an initial reply navigation instead of overwriting it with a bottom jump', async () => {
    render(<HistoryScreen navigation={{ messageId: 'lab-history-12', requestId: 1 }} />);
    await settleInitialFrame();
    expect(screen.getByText('lab-history-12')).toBeTruthy();
    expect(screen.queryByText('lab-history-100')).toBeNull();
  });

  it('opens the latest history under Strict Mode effect remounting', async () => {
    render(
      <StrictMode>
        <HistoryScreen />
      </StrictMode>,
    );
    await settleInitialFrame();
    expect(screen.getByText('lab-history-100')).toBeTruthy();
    expect(screen.queryByText('lab-history-1')).toBeNull();
  });
});

describe('latest message navigation', () => {
  it('mounts the destination before moving and keeps send compensation out of navigation', async () => {
    render(<HistoryScreen />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    fireEvent.wheel(viewport);
    act(() => {
      viewport.scrollTo({ top: 0 });
    });
    await settleInitialFrame();
    expect(screen.queryByText('lab-history-100')).toBeNull();
    const startingOffset = viewport.scrollTop;

    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(screen.getByText('lab-history-100')).toBeTruthy();
    expect(viewport.scrollTop).toBe(startingOffset);
    expect(screen.getByTestId('animated-rows').style.transform).toBe('');
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });

  it('does not resume a cancelled bottom navigation after the next layout update', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    fireEvent.wheel(viewport);
    act(() => {
      viewport.scrollTo({ top: viewport.scrollTop - READING_SCROLL_DISTANCE });
    });
    await settleInitialFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);

    fireEvent.wheel(viewport);
    const readingOffset = viewport.scrollTop - INTERRUPTION_SCROLL_DISTANCE;
    act(() => {
      viewport.scrollTo({ top: readingOffset });
    });
    view.rerender(<HistoryScreen />);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(readingOffset, 0);
  });

  it('does not resurrect Latest when a subsequent message navigation is cleared', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    view.rerender(<HistoryScreen navigation={{ messageId: 'lab-history-12', requestId: 1 }} />);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);

    view.rerender(<HistoryScreen />);
    const viewport = screen.getByLabelText('Message history');
    // Clearing a message request uses the existing initial-positioning path, with no old
    // Latest request allowed to reserve another navigation corridor after it.
    await settleInitialFrame();
    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });
});

describe('new message reveal', () => {
  it('moves toward an appended message over several frames before landing at the bottom', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    const startingOffset = viewport.scrollTop;

    view.rerender(<HistoryScreen historyRows={appendMessage({ authorId: CURRENT_USER_ID })} />);
    expect(viewport.scrollTop).toBeCloseTo(startingOffset, 1);
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);
    const endingOffset = viewport.scrollHeight - viewport.clientHeight;
    expect(viewport.scrollTop).toBeGreaterThan(startingOffset);
    expect(viewport.scrollTop).toBeLessThan(endingOffset - 1);

    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(endingOffset, 0);
  });

  it('preserves the reading position when an incoming message arrives away from the bottom', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    fireEvent.wheel(viewport);
    act(() => {
      viewport.scrollTo({ top: viewport.scrollTop - READING_SCROLL_DISTANCE });
    });
    await settleInitialFrame();
    const readingOffset = viewport.scrollTop;

    view.rerender(<HistoryScreen historyRows={appendMessage({ authorId: 'alex' })} />);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(readingOffset, 0);
  });

  it('lets a user gesture interrupt the reveal without returning to the bottom', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    view.rerender(<HistoryScreen historyRows={appendMessage({ authorId: CURRENT_USER_ID })} />);
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);

    fireEvent.wheel(viewport);
    act(() => {
      viewport.scrollTo({ top: viewport.scrollTop - INTERRUPTION_SCROLL_DISTANCE });
    });
    await settleInitialFrame();
    const readingOffset = viewport.scrollTop;
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(readingOffset, 0);
  });
});

describe('reveal coordination', () => {
  it('waits to mark an incoming message until its reveal has finished', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const onReachMessage = vi.fn();
    const messages = createHistoryMessages().slice(0, SHORT_HISTORY_MESSAGE_COUNT);
    const view = render(
      <HistoryScreen historyRows={createHistoryRows(messages)} onReachMessage={onReachMessage} />,
    );
    await settleInitialFrame();
    const newest = {
      ...messages[messages.length - 1],
      id: 'new-message',
      authorId: 'alex',
    };

    view.rerender(
      <HistoryScreen
        historyRows={createHistoryRows([...messages, newest])}
        onReachMessage={onReachMessage}
      />,
    );
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);
    expect(onReachMessage).not.toHaveBeenCalledWith(newest.id);

    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(onReachMessage).toHaveBeenLastCalledWith(newest.id);
  });

  it('preserves the list position while a photo replaces the attachment preview', async () => {
    const view = render(<HistoryScreen overlayInsets={REPLY_OVERLAY_INSETS} />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    const startingOffset = viewport.scrollTop;
    const messages = createHistoryMessages().slice(0, HISTORY_MESSAGE_COUNT);
    const photoMessage = {
      ...messages[messages.length - 1],
      id: 'new-photo',
      authorId: CURRENT_USER_ID,
      text: '',
      attachment: {
        url: '/photo.png',
        name: 'photo.png',
        width: 300,
        height: 900,
      },
    };
    view.rerender(
      <HistoryScreen
        historyRows={createHistoryRows([...messages, photoMessage])}
        overlayInsets={COMPOSER_OVERLAY_INSETS}
      />,
    );
    const animatedRows = screen.getByTestId('animated-rows');
    const revealOffset =
      Number.parseFloat(animatedRows.style.transform.slice('translateY('.length)) || 0;
    expect(viewport.scrollTop - revealOffset).toBeCloseTo(startingOffset, 1);
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);
    const targetOffset = viewport.scrollHeight - viewport.clientHeight;
    const remainingDistance = Math.abs(viewport.scrollTop - targetOffset);
    expect(remainingDistance).toBeGreaterThan(0);
    expect(remainingDistance).toBeLessThan(Math.abs(startingOffset - targetOffset));
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });

  it('reveals incoming messages while already following the latest history', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    const startingOffset = viewport.scrollTop;
    view.rerender(<HistoryScreen historyRows={appendMessage({ authorId: 'alex' })} />);
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);
    expect(viewport.scrollTop).toBeGreaterThan(startingOffset);
    expect(viewport.scrollTop).toBeLessThan(viewport.scrollHeight - viewport.clientHeight - 1);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });

  it('gives a message arriving late in the reveal enough time to move into view', async () => {
    const view = render(<HistoryScreen />);
    await settleInitialFrame();
    const appendedRows = appendMessage({ authorId: CURRENT_USER_ID });
    view.rerender(<HistoryScreen historyRows={appendedRows} />);
    await advanceAnimation(LATE_REVEAL_DELAY_MS);
    const viewport = screen.getByLabelText('Message history');
    const intermediateOffset = viewport.scrollTop;
    const lastRow = appendedRows[appendedRows.length - 1];
    const nextRows = [...appendedRows, { ...lastRow, key: 'second-new-message' }];
    view.rerender(<HistoryScreen historyRows={nextRows} />);
    await advanceAnimation(ANIMATION_SAMPLE_DELAY_MS);
    expect(viewport.scrollTop).toBeGreaterThan(intermediateOffset);
    expect(viewport.scrollTop).toBeLessThan(viewport.scrollHeight - viewport.clientHeight - 1);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });

  it('moves bottom-aligned rows together when a short conversation gains a message', async () => {
    const messages = createHistoryMessages().slice(0, SHORT_HISTORY_MESSAGE_COUNT);
    const view = render(<HistoryScreen historyRows={createHistoryRows(messages)} />);
    await settleInitialFrame();
    const animatedRows = screen.getByTestId('animated-rows');
    expect(animatedRows.style.transform).toBe('');
    const firstRow = screen.getByText(messages[0].id);
    const startingTop = Number.parseFloat(firstRow.style.top);
    const lastMessage = messages[messages.length - 1];
    const appendedMessages = [
      ...messages,
      {
        ...lastMessage,
        id: 'new-message',
        authorId: CURRENT_USER_ID,
      },
    ];
    view.rerender(<HistoryScreen historyRows={createHistoryRows(appendedMessages)} />);
    const revealOffset = Number.parseFloat(
      animatedRows.style.transform.slice('translateY('.length),
    );
    const visibleTop = Number.parseFloat(firstRow.style.top) + revealOffset;
    expect(visibleTop).toBeCloseTo(startingTop, 1);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(animatedRows.style.transform).toBe('');
    expect(screen.getByLabelText('Message history').scrollTop).toBe(0);
  });

  it('keeps revealing the message when sending collapses the reply helper', async () => {
    const view = render(<HistoryScreen overlayInsets={REPLY_OVERLAY_INSETS} />);
    await settleInitialFrame();
    const viewport = screen.getByLabelText('Message history');
    const startingOffset = viewport.scrollTop;
    view.rerender(
      <HistoryScreen
        historyRows={appendMessage({ authorId: CURRENT_USER_ID })}
        overlayInsets={COMPOSER_OVERLAY_INSETS}
      />,
    );
    const animatedRows = screen.getByTestId('animated-rows');
    const revealOffset =
      Number.parseFloat(animatedRows.style.transform.slice('translateY('.length)) || 0;
    expect(viewport.scrollTop - revealOffset).toBeCloseTo(startingOffset, 1);
    await advanceAnimation(ANIMATION_SETTLE_DELAY_MS);
    expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
  });
});
