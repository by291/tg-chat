import { describe, expect, it } from 'vitest';
import { hasMessageEditChanged } from './messageEditing';

describe('unsaved message edits', () => {
  it('ignores surrounding whitespace while shifting emoji ranges with the trimmed text', () => {
    expect(
      hasMessageEditChanged({
        original: {
          text: '😀',
          customEmoji: [
            {
              documentId: 'original',
              offset: 0,
              length: 2,
            },
          ],
        },
        current: {
          text: ' 😀 ',
          customEmoji: [
            {
              documentId: 'original',
              offset: 1,
              length: 2,
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it('detects a different custom emoji even when its Unicode fallback is unchanged', () => {
    expect(
      hasMessageEditChanged({
        original: {
          text: '😀',
          customEmoji: [
            {
              documentId: 'original',
              offset: 0,
              length: 2,
            },
          ],
        },
        current: {
          text: '😀',
          customEmoji: [
            {
              documentId: 'replacement',
              offset: 0,
              length: 2,
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('detects replacing an animated emoji with its ordinary Unicode fallback', () => {
    expect(
      hasMessageEditChanged({
        original: {
          text: '😀',
          customEmoji: [
            {
              documentId: 'original',
              offset: 0,
              length: 2,
            },
          ],
        },
        current: { text: '😀' },
      }),
    ).toBe(true);
  });
});
