// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import {
  DEFAULT_APP_PREFERENCES,
  getAppPreferences,
  setAppPreferences,
} from '@/features/settings/appPreferences';
import { STICKERS, STICKER_PACKS } from './stickerCatalog';
import { getOrderedStickerPacks, rememberSentSticker } from './stickerPackOrder';

afterEach(() => setAppPreferences(DEFAULT_APP_PREFERENCES));

it('moves a sent sticker pack to the front and preserves the remaining order', () => {
  const lastPack = STICKER_PACKS.at(-1)!;
  const sticker = STICKERS.find((entry) => entry.packId === lastPack.id)!;
  rememberSentSticker(sticker.id);
  rememberSentSticker(sticker.id);

  const ordered = getOrderedStickerPacks(getAppPreferences().stickerPackOrder);
  expect(ordered[0].id).toBe(lastPack.id);
  expect(ordered.slice(1)).toEqual(STICKER_PACKS.slice(0, -1));
});

it('freezes the current pack order when dynamic ordering is disabled', () => {
  const lastPack = STICKER_PACKS.at(-1)!;
  setAppPreferences({
    shouldUseDynamicPackOrder: false,
    stickerPackOrder: [lastPack.id],
  });
  rememberSentSticker(STICKERS[0].id);
  expect(getOrderedStickerPacks(getAppPreferences().stickerPackOrder)[0].id).toBe(lastPack.id);
});

it('ignores missing and duplicate packs while retaining newly installed ones', () => {
  const firstPack = STICKER_PACKS[0];
  // prettier-ignore
  const savedOrder = [
    'missing',
    firstPack.id,
    firstPack.id,
  ];
  expect(getOrderedStickerPacks(savedOrder)).toEqual(STICKER_PACKS);
});
