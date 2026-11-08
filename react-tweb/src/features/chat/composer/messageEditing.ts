import { trimEmojiText, type EmojiText } from '@/features/emoji/customEmojiEntities';

/** Compare the message that would be saved, including custom emoji identity and ranges. */
export function hasMessageEditChanged(options: { original: EmojiText; current: EmojiText }) {
  const original = trimEmojiText(options.original);
  const current = trimEmojiText(options.current);
  if (original.text !== current.text) {
    return true;
  }
  if ((original.richText ?? '') !== (current.richText ?? '')) {
    return true;
  }

  const originalEntities = original.customEmoji ?? [];
  const currentEntities = current.customEmoji ?? [];
  if (originalEntities.length !== currentEntities.length) {
    return true;
  }

  return originalEntities.some((entity, index) => {
    const candidate = currentEntities[index];
    return (
      entity.documentId !== candidate.documentId ||
      entity.offset !== candidate.offset ||
      entity.length !== candidate.length
    );
  });
}
