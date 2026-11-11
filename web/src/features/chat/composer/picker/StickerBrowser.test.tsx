// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectedStickerPackScope } from '@/features/settings/connected/StickerPackScope';
import { StickerBrowser } from './StickerBrowser';

const DUCK_STICKER = 'UtyaDuck-AgAD8gADVp29Cg';

class TestObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestObserver);
  vi.stubGlobal('IntersectionObserver', TestObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uses the account pack selection in navigation, favorites, and search', async () => {
  const user = userEvent.setup();
  render(
    <ConnectedStickerPackScope packIds={['shark_animated', 'Crocosaurus']}>
      <StickerBrowser
        recentStickers={[DUCK_STICKER]}
        favoriteStickers={[DUCK_STICKER]}
        onSelect={() => {}}
        onToggleFavorite={() => {}}
      />
    </ConnectedStickerPackScope>,
  );
  const packs = within(screen.getByLabelText('Sticker sets'));
  const labels = packs.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
  expect(labels).toEqual(['Shark Animated (@TgSticker)', 'Cubigator']);

  await user.type(screen.getByRole('textbox', { name: 'Search Stickers' }), 'Duck 01');
  expect(screen.getByText('No stickers found')).toBeTruthy();
});
