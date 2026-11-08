// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeEmoji } from './ThemeEmoji';
import { setAppPreferences } from '../appPreferences';

const PLAYBACK_WAIT_MS = 500;
const animation = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  play: vi.fn(),
  pause: vi.fn(),
  goToAndStop: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@/features/stickers/loadStickerAnimation', () => ({
  loadStickerAnimation: async () => ({}),
}));

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: {
    loadAnimation: () => ({
      ...animation,
      addEventListener: (name: string, listener: () => void) => {
        animation.listeners.set(name, listener);
      },
    }),
  },
}));

let motionQuery: EventTarget & { matches: boolean };

beforeEach(() => {
  animation.listeners.clear();
  vi.clearAllMocks();
  motionQuery = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => motionQuery);
  setAppPreferences({ shouldAnimateStickers: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function EmojiSelection() {
  const [isPlaying, setIsPlaying] = useState(false);
  return (
    <button onClick={() => setIsPlaying(true)} aria-label="Select theme">
      <ThemeEmoji
        themeId="rose"
        fallback="Rose"
        isPlaying={isPlaying}
        onComplete={() => setIsPlaying(false)}
      />
      <span>{isPlaying ? 'Playing' : 'Idle'}</span>
    </button>
  );
}

async function renderReadyEmoji() {
  render(<EmojiSelection />);
  await waitFor(() => expect(animation.listeners.has('DOMLoaded')).toBe(true));
  act(() => animation.listeners.get('DOMLoaded')?.());
  vi.useFakeTimers();
}

function changeReducedMotion({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  act(() => {
    motionQuery.matches = shouldReduceMotion;
    motionQuery.dispatchEvent(new Event('change'));
  });
}

function advancePlayback() {
  act(() => vi.advanceTimersByTime(PLAYBACK_WAIT_MS));
}

it('consumes a selection made with reduced motion without replaying it later', async () => {
  motionQuery.matches = true;
  await renderReadyEmoji();
  fireEvent.click(screen.getByRole('button', { name: 'Select theme' }));

  expect(screen.getByText('Idle')).toBeTruthy();
  changeReducedMotion({ shouldReduceMotion: false });
  advancePlayback();
  expect(animation.play).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Select theme' }));
  advancePlayback();
  expect(animation.play).toHaveBeenCalledTimes(1);
});

it('stops active playback and consumes its selection when reduced motion is enabled', async () => {
  await renderReadyEmoji();
  fireEvent.click(screen.getByRole('button', { name: 'Select theme' }));
  advancePlayback();
  expect(animation.play).toHaveBeenCalledTimes(1);
  animation.pause.mockClear();

  changeReducedMotion({ shouldReduceMotion: true });

  expect(animation.pause).toHaveBeenCalled();
  expect(screen.getByText('Idle')).toBeTruthy();
  changeReducedMotion({ shouldReduceMotion: false });
  advancePlayback();
  expect(animation.play).toHaveBeenCalledTimes(1);
});

it('cancels delayed playback when motion is disabled before the animation starts', async () => {
  await renderReadyEmoji();
  fireEvent.click(screen.getByRole('button', { name: 'Select theme' }));
  changeReducedMotion({ shouldReduceMotion: true });
  advancePlayback();

  expect(animation.play).not.toHaveBeenCalled();
  expect(screen.getByText('Idle')).toBeTruthy();
});

it('consumes a selection while sticker animation is disabled', async () => {
  setAppPreferences({ shouldAnimateStickers: false });
  await renderReadyEmoji();
  fireEvent.click(screen.getByRole('button', { name: 'Select theme' }));

  expect(screen.getByText('Idle')).toBeTruthy();
  act(() => setAppPreferences({ shouldAnimateStickers: true }));
  advancePlayback();
  expect(animation.play).not.toHaveBeenCalled();
});
