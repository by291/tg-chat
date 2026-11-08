// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PinnedConversationSorting, SortableChatRow } from './PinnedConversationSorting';

const ROW_HEIGHT = 72;
const ROW_WIDTH = 300;
// prettier-ignore
const INITIAL_PINNED_IDS = [
  'offscreen',
  'first',
  'second',
];

function VirtualPinnedList() {
  const [pinnedIds, setPinnedIds] = useState(INITIAL_PINNED_IDS);
  const visibleIds = [...pinnedIds.filter((id) => id !== 'offscreen'), 'regular'];
  return (
    <>
      <PinnedConversationSorting pinnedIds={pinnedIds} onReorder={setPinnedIds}>
        {visibleIds.map((id, index) => (
          <div key={id} data-test-row={id} data-position={index}>
            <SortableChatRow id={id} title={id} isActive={false} isDisabled={id === 'regular'}>
              <button>{id}</button>
            </SortableChatRow>
          </div>
        ))}
      </PinnedConversationSorting>
      <output aria-label="Pinned order">{pinnedIds.join(',')}</output>
    </>
  );
}

beforeEach(() => {
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.stubGlobal('IntersectionObserver', LayoutObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.animate = () =>
    ({
      finished: Promise.resolve(),
      cancel() {},
      finish() {},
    }) as unknown as Animation;
  document.getAnimations = () => [];
  document.elementFromPoint = () => document.body;
  Element.prototype.getAnimations = () => [];
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.closest<HTMLElement>('[data-test-row]');
    const index = Number(row?.dataset.position ?? 0);
    // jsdom has no layout engine; include CSS translation when measuring the drag feedback.
    const style = (this as HTMLElement).style;
    const translation = style.getPropertyValue('--dnd-translate').split(' ');
    const translatedLeft = Number.parseFloat(translation[0]) || 0;
    const translatedTop = Number.parseFloat(translation[1]) || 0;
    const top = Number.parseFloat(style.getPropertyValue('--dnd-top')) || index * ROW_HEIGHT;
    return DOMRect.fromRect({
      x: translatedLeft,
      y: top + translatedTop,
      width: ROW_WIDTH,
      height: ROW_HEIGHT,
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reorders visible pinned identities without moving children across virtual rows', async () => {
  const user = userEvent.setup();
  render(<VirtualPinnedList />);
  const firstButton = screen.getByRole('button', { name: 'first' });
  const firstWrapper = firstButton.closest('[data-test-row]');
  const grip = screen.getByRole('button', { name: 'Reorder first' });
  grip.focus();
  await user.keyboard('[Space]');
  await waitFor(() => expect(grip.getAttribute('aria-pressed')).toBe('true'));
  await user.keyboard('[ArrowDown]');
  await waitFor(() => {
    const target = screen.getByRole('button', { name: 'second' }).parentElement;
    expect(target?.getAttribute('data-drop-target')).toBe('true');
  });
  await user.keyboard('[Space]');
  await waitFor(() => {
    expect(screen.getByLabelText('Pinned order').textContent).toBe('offscreen,second,first');
  });
  expect(firstButton.closest('[data-test-row]')).toBe(firstWrapper);
  expect(firstWrapper?.getAttribute('data-test-row')).toBe('first');
});
