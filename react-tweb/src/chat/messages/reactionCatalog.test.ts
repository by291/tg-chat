import catalog from '@emoji-mart/data/sets/15/native.json';
import { describe, expect, it } from 'vitest';
import { createReactionCatalog, searchReactionCatalog } from './reactionCatalog';

const sections = createReactionCatalog(catalog);

describe('reaction catalog', () => {
  it('finds an exact skin variant instead of substituting the base emoji', () => {
    const results = searchReactionCatalog({ sections, query: '👍🏿' });
    const values = results.flatMap((section) => section.items.map((item) => item.value));

    expect(values).toEqual(['👍🏿']);
  });

  it('deduplicates popular results while keeping custom artwork with the same emoji distinct', () => {
    const results = searchReactionCatalog({ sections, query: '😂' });
    const choices = results.flatMap((section) => section.items);
    const native = choices.filter((choice) => choice.value === '😂');
    const custom = choices.filter((choice) => choice.custom);

    expect(native).toHaveLength(1);
    expect(custom.length).toBeGreaterThan(0);
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);
  });

  it('matches custom artwork by the meaning of its native emoji', () => {
    const results = searchReactionCatalog({ sections, query: 'tears of joy' });
    const choices = results.flatMap((section) => section.items);

    expect(choices.some((choice) => choice.value === '😂')).toBe(true);
    expect(choices.some((choice) => choice.custom?.emoji === '😂')).toBe(true);
  });
});
