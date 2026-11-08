// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SearchDateDialog } from './SearchDateDialog';

const CALENDAR_HEIGHT = 312;
const CALENDAR_WIDTH = 420;
const SELECTED_DATE = new Date(2025, 9, 8).getTime();

beforeAll(() => {
  class TestObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', TestObserver);
  vi.stubGlobal('IntersectionObserver', TestObserver);
  Element.prototype.getBoundingClientRect = () => {
    return new DOMRect(0, 0, CALENDAR_WIDTH, CALENDAR_HEIGHT);
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => CALENDAR_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      const content = this.firstElementChild;
      return content instanceof HTMLElement ? Number.parseFloat(content.style.height || '0') : 0;
    },
  });
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (!options || typeof options === 'number') {
      return;
    }

    const nextOffset = Math.max(0, options.top ?? 0);
    if (this.scrollTop !== nextOffset) {
      this.scrollTop = nextOffset;
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    }
  };
});

afterEach(cleanup);

it('mounts and focuses a year jump whose destination was outside the virtual window', async () => {
  render(
    <SearchDateDialog isOpen initialDate={SELECTED_DATE} onClose={() => {}} onSelect={() => {}} />,
  );
  const selected = await screen.findByRole('button', { name: 'Wednesday, October 8, 2025' });
  selected.focus();
  fireEvent.keyDown(selected, { key: 'PageUp', shiftKey: true });

  await waitFor(() => {
    const destination = screen.getByRole('button', { name: 'Tuesday, October 8, 2024' });
    expect(document.activeElement).toBe(destination);
  });
});
