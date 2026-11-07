// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import { MessageBubble } from './MessageBubble';
import {
  createOutgoingMessageTransitions,
  type OutgoingMessageOrigin,
} from './outgoingMessageTransition';

const FRAME_DURATION_MS = 16;
const SETTLED_ANIMATION_MS = 640;
const SOURCE_RECTANGLE = {
  left: 100,
  top: 600,
  width: 600,
  height: 48,
};
const TARGET_RECTANGLE = {
  left: 400,
  top: 540,
  width: 300,
  height: 30,
};
const message = {
  ...createHistoryMessages()[0],
  id: 'outgoing-message',
  authorId: 'you',
  authorName: 'You',
  text: 'A message in flight',
};

function createOrigin(): OutgoingMessageOrigin {
  const content = document.createElement('div');
  content.textContent = message.text;
  return {
    field: SOURCE_RECTANGLE,
    editor: SOURCE_RECTANGLE,
    content,
    textStart: { left: SOURCE_RECTANGLE.left, top: SOURCE_RECTANGLE.top },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), FRAME_DURATION_MS);
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => window.clearTimeout(frame));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return DOMRect.fromRect(
      this.hasAttribute('data-message-content') ? TARGET_RECTANGLE : SOURCE_RECTANGLE,
    );
  });
  Range.prototype.getBoundingClientRect = () => DOMRect.fromRect(TARGET_RECTANGLE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderOutgoingMessage() {
  const container = document.createElement('main');
  document.body.append(container);
  const transitions = createOutgoingMessageTransitions({ getContainer: () => container });
  transitions.prepare({ messageId: message.id, origin: createOrigin() });
  const view = render(
    <StrictMode>
      <section aria-label="Message history">
        <MessageBubble
          message={message}
          onMount={transitions.mount}
          isGroupStart
          isGroupEnd
          isHighlighted={false}
          onInteract={() => {}}
          onReact={() => {}}
          onOpenMedia={() => {}}
          onJumpToMessage={() => {}}
        />
      </section>
    </StrictMode>,
    { container },
  );
  const bubble = container.querySelector<HTMLElement>('[data-message-content]')!;
  return {
    container,
    transitions,
    view,
    bubble,
  };
}

describe('outgoing message flight', () => {
  it('keeps the original covered through Strict Mode replay until landing', () => {
    const { container, bubble } = renderOutgoingMessage();
    expect(bubble.style.opacity).toBe('0');
    expect(container.querySelector(':scope > [aria-hidden="true"]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(SETTLED_ANIMATION_MS));
    expect(bubble.style.opacity).toBe('');
    expect(container.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
  });

  it('removes the temporary layer and restores the message when the conversation disposes', () => {
    const { container, transitions, bubble } = renderOutgoingMessage();
    act(() => vi.advanceTimersByTime(FRAME_DURATION_MS));
    transitions.dispose();

    expect(bubble.style.opacity).toBe('');
    expect(container.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
    act(() => vi.advanceTimersByTime(SETTLED_ANIMATION_MS));
    expect(container.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
  });

  it('restores the real message immediately when keyboard navigation interrupts the flight', () => {
    const { container, bubble } = renderOutgoingMessage();
    const history = container.querySelector('[aria-label="Message history"]')!;
    act(() => vi.advanceTimersByTime(FRAME_DURATION_MS));
    fireEvent.keyDown(history, { key: 'PageUp' });

    expect(bubble.style.opacity).toBe('');
    expect(container.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
  });

  it('drops the temporary layer when the message unmounts during its flight', () => {
    const { container, view } = renderOutgoingMessage();
    view.unmount();
    act(() => vi.advanceTimersByTime(FRAME_DURATION_MS));
    expect(container.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
  });
});
