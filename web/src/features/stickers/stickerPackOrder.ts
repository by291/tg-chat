import { getAppPreferences, setAppPreferences } from '@/features/settings/appPreferences';
import { findSticker, STICKER_PACKS } from './stickerCatalog';

/** Retain saved pack order while appending newly installed packs and ignoring stale identifiers. */
export function getOrderedStickerPacks(order: string[]) {
  const remaining = new Map(STICKER_PACKS.map((pack) => [pack.id, pack]));
  const ordered: typeof STICKER_PACKS = [];

  for (const id of order) {
    const pack = remaining.get(id);
    if (!pack) {
      continue;
    }

    ordered.push(pack);
    remaining.delete(id);
  }

  return [...ordered, ...remaining.values()];
}

/** Promote a sent sticker's pack only while automatic pack ordering is enabled. */
export function rememberSentSticker(id: string) {
  const preferences = getAppPreferences();
  const sticker = findSticker(id);
  if (!preferences.shouldUseDynamicPackOrder || !sticker) {
    return;
  }

  const remaining = preferences.stickerPackOrder.filter((packId) => packId !== sticker.packId);
  setAppPreferences({ stickerPackOrder: [sticker.packId, ...remaining] });
}
