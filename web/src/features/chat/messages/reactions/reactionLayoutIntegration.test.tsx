// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../../demo/fixtures';
import { MessageTimeline } from '../../history/MessageTimeline';
import { prepareReactionLayout } from './reactionLayoutTransition';

const VIEWPORT_HEIGHT = 500;
const VIEWPORT_WIDTH = 400;
const ROW_HEIGHT = 60;
const REACTION_HEIGHT = 30;
const ADDITIONAL_MESSAGE_COUNT = 12;
const initialMessage = createInitialState().messages[0];
const animationFrames: { element: Element; keyframes: Keyframe[] }[] = [];

function getRowHeight(element: Element) {
  return element.querySelector('[aria-label="Reactions"]')
    ? ROW_HEIGHT + REACTION_HEIGHT
    : ROW_HEIGHT;
}

beforeEach(() => {
  animationFrames.length = 0;
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height || '0');
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('aria-label') === 'Message history') {
      return DOMRect.fromRect({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
    }

    const row = this.closest<HTMLElement>('[data-index]');
    const rowOffset = Number.parseFloat(
      row?.style.transform.match(/translateY\(([-\d.]+)/)?.[1] ?? '0',
    );
    const viewport = row?.closest<HTMLElement>('[aria-label="Message history"]');
    const top = rowOffset - (viewport?.scrollTop ?? 0);
    const height = getRowHeight(row ?? this);
    return DOMRect.fromRect({
      y: top,
      width: VIEWPORT_WIDTH,
      height,
    });
  });
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (typeof options === 'object') {
      this.scrollTop = Math.max(0, options.top ?? 0);
    }
  };
  Element.prototype.animate = function (keyframes) {
    animationFrames.push({ element: this, keyframes: keyframes as Keyframe[] });
    return {
      cancel: () => {},
      finished: new Promise(() => {}),
    } as unknown as Animation;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Conversation({ hasReaction = false }: { hasReaction?: boolean }) {
  const [messages, setMessages] = useState([
    {
      ...initialMessage,
      id: 'reaction-target',
      reactions: hasReaction ? ['❤️'] : [],
    },
    {
      ...initialMessage,
      id: 'neighbor',
      reactions: [] as string[],
    },
    ...Array.from({ length: ADDITIONAL_MESSAGE_COUNT }, (_, index) => ({
      ...initialMessage,
      id: `additional-message-${index}`,
      reactions: [],
    })),
  ]);

  function toggleReaction() {
    setMessages((previous) => {
      const reactions = previous[0].reactions.length > 0 ? [] : ['❤️'];
      return [{ ...previous[0], reactions }, ...previous.slice(1)];
    });
  }
  return (
    <>
      <button
        onClick={() => {
          const row = document.querySelector<HTMLElement>('[data-message-id="reaction-target"]');
          if (!row) {
            return;
          }

          prepareReactionLayout({ row });
          toggleReaction();
        }}
      >
        React to message
      </button>
      <MessageTimeline
        messages={messages}
        searchQuery=""
        onCommand={() => {}}
        onReact={toggleReaction}
        onInteract={() => {}}
        onOpenMedia={() => {}}
        onJumpToMessage={() => {}}
      />
    </>
  );
}

it('preserves reaction capture through a real virtualized React commit in Strict Mode', async () => {
  const view = render(
    <StrictMode>
      <Conversation />
    </StrictMode>,
  );
  await waitFor(() => {
    expect(view.container.querySelector('[data-message-id="reaction-target"]')).not.toBeNull();
  });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  fireEvent.click(view.getByRole('button', { name: 'React to message' }));
  await act(async () => {
    await Promise.resolve();
  });

  const target = view.container.querySelector('[data-message-id="reaction-target"]')!;
  expect(target.querySelector('[data-reaction-layout-shell]')).not.toBeNull();
  expect(target.getBoundingClientRect().height).toBe(ROW_HEIGHT + REACTION_HEIGHT);
  view.unmount();
  expect(document.querySelector('[data-reaction-layout-shell]')).toBeNull();
});

it.each([
  { hasReaction: false, heightChange: REACTION_HEIGHT },
  { hasReaction: true, heightChange: -REACTION_HEIGHT },
])(
  'animates neighbors when a reaction changes height by $heightChange while scroll is active',
  async ({ hasReaction, heightChange }) => {
    const view = render(<Conversation hasReaction={hasReaction} />);
    const viewport = view.getByLabelText('Message history');
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);
    await waitFor(() => {
      expect(view.container.querySelector('[data-message-id="reaction-target"]')).not.toBeNull();
    });
    const neighbor = view.container.querySelector<HTMLElement>(
      '[data-message-id="neighbor"] [data-message-row-content]',
    )!;
    const previousTop = neighbor.getBoundingClientRect().top;
    const buttonName = hasReaction ? 'Remove ❤️ reaction' : 'React to message';
    fireEvent.click(view.getByRole('button', { name: buttonName }));
    await act(async () => {
      await Promise.resolve();
    });

    const movement = animationFrames.find((animation) => animation.element === neighbor);
    expect(movement?.keyframes).toEqual([
      { transform: `translateY(${-heightChange}px)` },
      { transform: 'translateY(0px)' },
    ]);
    expect(neighbor.getBoundingClientRect().top).toBe(previousTop + heightChange);
    expect(viewport.scrollTop).toBe(0);
  },
);
