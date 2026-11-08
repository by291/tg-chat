// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_APP_PREFERENCES, setAppPreferences } from '@/features/settings/appPreferences';
import { StickerArtwork } from './StickerArtwork';
import { StickerPlaybackScope } from './StickerPlaybackScope';

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
  setAppPreferences(DEFAULT_APP_PREFERENCES);
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

it('applies animation preferences to an already visible sticker', async () => {
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
  act(() => setAppPreferences({ shouldAnimateStickers: false }));
  expect(animation.isPaused).toBe(true);
  act(() => setAppPreferences({ shouldAnimateStickers: true }));
  await waitFor(() => expect(animation.isPaused).toBe(false));
});

it('keeps panel playback independent of chat autoplay and responds to panel changes', async () => {
  setAppPreferences({ shouldAutoplayStickersInChat: false });
  render(
    <StickerPlaybackScope group="panel" isActive={false}>
      <StickerArtwork
        sticker={{
          name: 'Panel sticker',
          source: '/sticker.json',
          preview: '/sticker.webp',
          renderer: 'svg',
        }}
      />
    </StickerPlaybackScope>,
  );
  act(() => {
    notifyVisibility(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  await waitFor(() => expect(animation.isPaused).toBe(false));
  act(() => setAppPreferences({ shouldAutoplayStickersInPanel: false }));
  expect(animation.isPaused).toBe(true);
  act(() => setAppPreferences({ shouldAutoplayStickersInPanel: true }));
  await waitFor(() => expect(animation.isPaused).toBe(false));
});

it('allows a held preview when automatic chat and panel playback are disabled', async () => {
  setAppPreferences({
    shouldAutoplayStickersInChat: false,
    shouldAutoplayStickersInPanel: false,
  });
  render(
    <StickerPlaybackScope group="preview">
      <StickerArtwork
        sticker={{
          name: 'Held sticker',
          source: '/sticker.json',
          preview: '/sticker.webp',
          renderer: 'svg',
        }}
      />
    </StickerPlaybackScope>,
  );
  act(() => {
    notifyVisibility(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  await waitFor(() => expect(animation.isPaused).toBe(false));
});
