import { describe, expect, it } from 'vitest';
import { CUSTOM_EMOJI } from '../emoji/customEmojiCatalog';
import { getCustomReactionKey, resolveReactionEmoji } from './reactionEmoji';

describe('stored reaction emoji', () => {
  it('preserves native skin tones and joined emoji without rewriting stored values', () => {
    const native = '👩🏽‍💻';
    expect(resolveReactionEmoji(native)).toEqual({ label: native, native });
  });

  it('resolves a custom document separately from its native fallback', () => {
    const custom = CUSTOM_EMOJI[0];
    const key = getCustomReactionKey(custom.id);
    const reaction = resolveReactionEmoji(key);

    expect(key).not.toBe(custom.emoji);
    expect(reaction.custom).toEqual(custom);
    expect(reaction.native).toBe(custom.emoji);
    expect(reaction.label).toBe(custom.name);
    expect(resolveReactionEmoji(custom.emoji).custom).toBeUndefined();
  });

  it('shows a readable fallback when a stored custom pack is unavailable', () => {
    const reaction = resolveReactionEmoji(getCustomReactionKey('unavailable-document'));
    expect(reaction.custom).toBeUndefined();
    expect(reaction.native).toBe('❔');
    expect(reaction.label).toBe('Unknown custom emoji');
  });
});
