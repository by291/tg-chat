import { describe, expect, it } from 'vitest';
import { mergeMessages, renderMessage, type CanonicalMessage } from './messageModels';

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
    reactions: [
      {
        emoji: '👍',
        count: '1',
        is_selected: true,
      },
    ],
  };
  const delayed = {
    ...message(1),
    version: '2',
    interaction_version: '3',
    reactions: [
      {
        emoji: '👍',
        count: '2',
        is_selected: true,
      },
    ],
  };
  const merged = mergeMessages({
    current: [current],
    incoming: [delayed],
    edge: 'latest',
  });
  expect(merged[0].content.text).toBe('Edited content');
  expect(merged[0].reactions[0].count).toBe('2');
});

it('drops the old link preview when a newer edit arrives before a reaction', () => {
  const current = {
    ...message(1),
    version: '3',
    interaction_version: '2',
    disable_link_preview: true,
  };
  const delayed = {
    ...message(1),
    version: '2',
    interaction_version: '3',
    link_preview: {
      url: 'https://example.test',
      site_name: 'Example',
      title: 'Old preview',
      summary: 'Old text',
    },
  };

  const [merged] = mergeMessages({
    current: [current],
    incoming: [delayed],
    edge: 'latest',
  });

  expect(renderMessage(merged).linkPreview).toBeUndefined();
  expect(renderMessage(merged).disableLinkPreview).toBe(true);
});

function hiddenPoll(): Extract<CanonicalMessage['body'], { kind: 'poll' }> {
  return {
    kind: 'poll',
    question: 'When?',
    options: [
      { id: 'today', text: 'Today' },
      { id: 'tomorrow', text: 'Tomorrow' },
    ],
    version: '2',
    is_anonymous: true,
    is_multiple_choice: false,
    can_revote: false,
    can_vote: true,
    can_add_options: false,
    can_edit: false,
    can_close: false,
    hide_results_until_close: true,
    is_closed: false,
    is_quiz: false,
    selected_option_ids: ['today'],
  };
}

it('keeps a newer poll selection when a delayed message body arrives', () => {
  const poll = hiddenPoll();
  const current = {
    ...message(1),
    version: '2',
    interaction_version: '2',
    body: poll,
  };
  const delayed = {
    ...current,
    version: '3',
    interaction_version: '1',
    body: { ...current.body, selected_option_ids: [] },
  };

  const merged = mergeMessages({
    current: [current],
    incoming: [delayed],
    edge: 'latest',
  });

  expect(renderMessage(merged[0]).media).toMatchObject({
    kind: 'poll',
    selectedOptionIds: ['today'],
    hasVisibleResults: false,
  });
});

it('retains closure when an equal-version projection predates the database deadline', () => {
  const openPoll = hiddenPoll();
  const closedPoll = {
    ...openPoll,
    is_closed: true,
    voter_count: 1,
  };
  const current = { ...message(1), body: closedPoll };
  const delayed = { ...message(1), body: openPoll };

  const merged = mergeMessages({
    current: [current],
    incoming: [delayed],
    edge: 'latest',
  });

  expect(renderMessage(merged[0]).media).toMatchObject({
    isClosed: true,
    hasVisibleResults: true,
    voterCount: 1,
  });
});

it('renders unavailable replies without exposing their former quote and keeps aggregate reactions', () => {
  const canonical = message(1);
  canonical.reply = {
    message_id: 'removed',
    is_unavailable: true,
    quote: 'Old private text',
  };
  canonical.reactions = [
    {
      emoji: '👍',
      count: '2',
      is_selected: false,
    },
  ];
  canonical.is_pinned = true;
  canonical.edited_at = canonical.created_at;
  const rendered = renderMessage(canonical);
  expect(rendered.replyQuote).toBeUndefined();
  expect(rendered.isReplyUnavailable).toBe(true);
  expect(rendered.reactionDetails?.[0]).toEqual({
    emoji: '👍',
    count: '2',
    isSelected: false,
  });
  expect(rendered.isPinned).toBe(true);
  expect(rendered.isEdited).toBe(true);
});

it('renders sticker assets and only the fields explicitly shared on a contact card', () => {
  const sticker = {
    ...message(1),
    body: { kind: 'sticker' as const, sticker_id: 'UtyaDuck-AgAD8gADVp29Cg' },
  };
  const contact = {
    ...message(2),
    body: {
      kind: 'contact' as const,
      display_name: 'Emergency contact',
      account_id: 'account',
      phone: '+1 555 0100',
    },
  };

  expect(renderMessage(sticker).sticker).toBe('UtyaDuck-AgAD8gADVp29Cg');
  expect(renderMessage(contact).media).toEqual({
    kind: 'contact',
    name: 'Emergency contact',
    userId: 'account',
    phone: '+1 555 0100',
    initials: '',
  });
});

it('keeps newer checklist completions when delayed content arrives', () => {
  const checklist: Extract<CanonicalMessage['body'], { kind: 'checklist' }> = {
    kind: 'checklist',
    title: 'Trail equipment',
    list_version: '1',
    can_others_complete: true,
    can_others_append: false,
    can_complete: true,
    can_append: false,
    can_edit: false,
    tasks: [
      {
        id: 'map',
        text: 'Bring a map',
        is_complete: true,
        version: '2',
      },
    ],
  };
  const current = {
    ...message(1),
    version: '2',
    interaction_version: '2',
    body: checklist,
  };
  const delayed = {
    ...current,
    version: '3',
    interaction_version: '1',
    body: {
      ...checklist,
      tasks: [{ id: 'map', text: 'Bring a map', is_complete: false, version: '1' }],
    },
  };

  const [merged] = mergeMessages({
    current: [current],
    incoming: [delayed],
    edge: 'latest',
  });

  expect(renderMessage(merged).media).toMatchObject({
    kind: 'checklist',
    items: [{ id: 'map', isCompleted: true, version: '2' }],
  });
});

it('renders an unanswered voice call as a service record in history', () => {
  const missed = message(1);
  const rendered = renderMessage({
    ...missed,
    service_kind: 'call',
    content: { ...missed.content, text: 'Voice call · missed' },
  });

  expect(rendered.isService).toBe(true);
  expect(rendered.text).toBe('Voice call · missed');
});
