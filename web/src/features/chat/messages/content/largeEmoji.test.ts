import { describe, expect, it } from 'vitest';
import { getLargeEmojiSize } from './largeEmoji';

describe('large emoji presentation', () => {
  it('counts joined families, flags, and skin tones as single emoji', () => {
    expect(getLargeEmojiSize({ text: '👨‍👩‍👧‍👦 🇨🇳 👍🏽' })).toBe(84);
    expect(getLargeEmojiSize({ text: '❤️\n❤️' })).toBe(90);
    expect(getLargeEmojiSize({ text: '😀'.repeat(10) })).toBe(36);
  });

  it('keeps text, captions, code, and quotes in their normal bubbles', () => {
    expect(getLargeEmojiSize({ text: 'Hello 😀' })).toBeUndefined();
    expect(getLargeEmojiSize({ text: '123' })).toBeUndefined();
    expect(getLargeEmojiSize({ text: ' \n ' })).toBeUndefined();
    expect(getLargeEmojiSize({ text: '😀', textStyle: 'code' })).toBeUndefined();
    expect(getLargeEmojiSize({ text: '😀', sticker: 'duck' })).toBeUndefined();
    expect(
      getLargeEmojiSize({ text: '😀', richText: '<blockquote>😀</blockquote>' }),
    ).toBeUndefined();
  });

  it('counts a custom emoji once even when its fallback contains several characters', () => {
    const customEmoji = {
      documentId: 'custom-face',
      offset: 0,
      length: 8,
    };
    expect(
      getLargeEmojiSize({
        text: ':custom: 😀',
        customEmoji: [customEmoji],
      }),
    ).toBe(90);
  });
});
