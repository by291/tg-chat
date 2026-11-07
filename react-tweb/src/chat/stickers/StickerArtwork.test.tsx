// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StickerArtwork } from './StickerArtwork';

const { animation } = vi.hoisted(() => ({
  animation: {
    isPaused: true,
    loop: true,
    addEventListener() {},
    play() {
      this.isPaused = false;
    },
    pause() {
      this.isPaused = true;
    },
    destroy() {},
  },
}));

vi.mock('./loadStickerAnimation', () => ({ loadStickerAnimation: async () => ({}) }));
vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: { loadAnimation: () => animation },
}));

let notifyVisibility: IntersectionObserverCallback;

beforeEach(() => {
  animation.isPaused = true;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notifyVisibility = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('pauses a sticker when the final batched intersection leaves the viewport', async () => {
  render(
    <StickerArtwork
      sticker={{
        name: 'Animated sticker',
        source: '/sticker.json',
        preview: '/sticker.webp',
        renderer: 'svg',
      }}
    />,
  );
  act(() => {
    notifyVisibility(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  await waitFor(() => expect(animation.isPaused).toBe(false));

  act(() => {
    notifyVisibility(
      [
        { isIntersecting: true } as IntersectionObserverEntry,
        { isIntersecting: false } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });

  expect(animation.isPaused).toBe(true);
});
