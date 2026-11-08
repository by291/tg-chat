import { z } from 'zod';
import { sanitizeRichText } from '@/features/chat/rich-text/richText';

export const customEmojiEntitySchema = z.object({
  documentId: z.string(),
  offset: z.int().nonnegative(),
  length: z.int().positive(),
});

export type CustomEmojiEntity = z.infer<typeof customEmojiEntitySchema>;

export interface EmojiText {
  text: string;
  richText?: string;
  customEmoji?: CustomEmojiEntity[];
}

export interface EmojiTextPart {
  text: string;
  offset: number;
  documentId?: string;
}

/** Split UTF-16 entity ranges while treating malformed or overlapping ranges as plain text. */
export function splitEmojiText({ text, customEmoji = [] }: EmojiText): EmojiTextPart[] {
  const parts: EmojiTextPart[] = [];
  const entities = [...customEmoji].sort((left, right) => left.offset - right.offset);
  let offset = 0;

  for (const entity of entities) {
    const end = entity.offset + entity.length;
    const isValid = entity.offset >= offset && end <= text.length && entity.length > 0;
    if (!isValid) {
      continue;
    }
    if (entity.offset > offset) {
      parts.push({ text: text.slice(offset, entity.offset), offset });
    }
    parts.push({
      text: text.slice(entity.offset, end),
      offset: entity.offset,
      documentId: entity.documentId,
    });
    offset = end;
  }

  if (offset < text.length) {
    parts.push({ text: text.slice(offset), offset });
  }
  return parts;
}

/** Trim message whitespace and move entity offsets by the same UTF-16 distance. */
export function trimEmojiText(value: EmojiText): EmojiText {
  const leadingLength = value.text.length - value.text.trimStart().length;
  const text = value.text.trim();
  const customEmoji = value.customEmoji?.filter((entity) => {
    return (
      entity.offset >= leadingLength && entity.offset + entity.length <= leadingLength + text.length
    );
  });
  return {
    text,
    richText: value.richText ? sanitizeRichText(value.richText) : undefined,
    customEmoji: customEmoji?.map((entity) => ({
      ...entity,
      offset: entity.offset - leadingLength,
    })),
  };
}
