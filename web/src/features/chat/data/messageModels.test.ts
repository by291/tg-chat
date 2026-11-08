import { describe, expect, it } from 'vitest';
import { mergeMessages, type CanonicalMessage } from './messageModels';

function message(sequence: number): CanonicalMessage {
  return {
    id: `message-${sequence}`,
    conversation_id: 'conversation',
    author_id: 'author',
    author_name: 'Author',
    sequence: String(sequence),
    version: '9007199254740993',
    interaction_version: '1',
    is_deleted: false,
    is_pinned: false,
    reactions: [],
    created_at: '2026-11-09T00:00:00Z',
    content: {
      schema_version: 1,
      text: 'Latest content',
      rich_text: null,
      custom_emoji: [],
    },
  };
}

describe('bounded canonical projections', () => {
  it('retains exact version ordering and one row per durable identity', () => {
    const latest = message(1);
    const stale = { ...latest, version: '9007199254740992' };
    expect(
      mergeMessages({
        current: [latest],
        incoming: [stale],
        edge: 'latest',
      }),
    ).toEqual([latest]);
  });

  it('keeps the selected edge within the 200-message memory budget', () => {
    const incoming = Array.from({ length: 250 }, (_, index) => message(index + 1));
    const latest = mergeMessages({
      current: [],
      incoming,
      edge: 'latest',
    });
    const older = mergeMessages({
      current: [],
      incoming,
      edge: 'older',
    });
    expect(latest).toHaveLength(200);
    expect(latest[0].sequence).toBe('51');
    expect(older).toHaveLength(200);
    expect(older.at(-1)?.sequence).toBe('200');
  });
});

it('merges content and interaction versions independently when responses cross', () => {
  const current = {
    ...message(1),
    version: '3',
    interaction_version: '2',
    content: { ...message(1).content, text: 'Edited content' },
    reactions: [{ emoji: '👍', count: '1', is_selected: true }],
  };
  const delayed = {
    ...message(1),
    version: '2',
    interaction_version: '3',
    reactions: [{ emoji: '👍', count: '2', is_selected: true }],
  };
  const merged = mergeMessages({ current: [current], incoming: [delayed], edge: 'latest' });
  expect(merged[0].content.text).toBe('Edited content');
  expect(merged[0].reactions[0].count).toBe('2');
});
