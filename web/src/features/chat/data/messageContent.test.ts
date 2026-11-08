// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import fixtures from '../../../../../contracts/message-content.json';
import { canonicalMessageContent } from './messageContent';

describe('canonical message transport', () => {
  for (const fixture of fixtures) {
    it(`preserves ${fixture.name}`, () => {
      const input = fixture.input;
      const canonical = canonicalMessageContent({
        text: input.text,
        richText: input.rich_text ?? undefined,
        customEmoji: input.custom_emoji.map((entity) => ({
          documentId: entity.document_id,
          offset: entity.offset,
          length: entity.length,
        })),
      });

      expect(canonical.text).toBe(input.text);
      expect(canonical.custom_emoji).toEqual(input.custom_emoji);
      expect(canonical.rich_text ?? '').not.toContain('onclick');
      expect(canonical.rich_text ?? '').not.toContain('javascript:');
    });
  }

  it('derives wire offsets from rich structure instead of Lexical internal separators', () => {
    const canonical = canonicalMessageContent({
      text: 'First\n\n😂',
      richText: '<p>First</p><p><span data-custom-emoji="5249007745805328497">😂</span></p>',
      customEmoji: [
        {
          documentId: '5249007745805328497',
          offset: 7,
          length: 2,
        },
      ],
    });
    expect(canonical.text).toBe('First\n😂');
    expect(canonical.custom_emoji[0].offset).toBe(6);
  });
});
