import type { CanonicalMessage, Conversation } from './messageModels';

/** Create a complete canonical message for behavioral cache and ownership tests. */
export function canonicalFixture(overrides: Partial<CanonicalMessage> = {}): CanonicalMessage {
  return {
    id: 'message-1',
    conversation_id: 'conversation',
    author_id: 'author',
    author_name: 'Author',
    sequence: '1',
    version: '1',
    interaction_version: '1',
    is_deleted: false,
    is_pinned: false,
    reactions: [],
    created_at: '2026-11-09T00:00:00Z',
    content: {
      schema_version: 1,
      text: 'Visible content',
      custom_emoji: [],
    },
    ...overrides,
  };
}

/** Create one bounded-directory projection with an independent draft version. */
export function conversationFixture(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation',
    kind: 'saved',
    settings_version: '1',
    title: '',
    description: '',
    is_public: false,
    requires_approval: false,
    role: 'member',
    can_post: true,
    can_manage: true,
    peer_id: 'author',
    peer_name: 'Author',
    peer_username: 'author',
    last_sequence: '1',
    version: '1',
    summary_text: 'Visible content',
    updated_at: '2026-11-09T00:00:00Z',
    generation: '1',
    unread_count: '0',
    read_through: '0',
    clear_through: '0',
    peer_read_through: '0',
    is_archived: false,
    is_hidden: false,
    is_manually_unread: false,
    keep_archived: false,
    expiry_days: 0,
    draft: { version: '0' },
    ...overrides,
  };
}

/** Encode a scoped cursor exactly as the server does, retaining decimal precision. */
export function cursorFixture(position: number): string {
  return btoa(
    JSON.stringify({
      deployment_id: 'test-deployment',
      user_id: '00000000-0000-4000-8000-000000000001',
      position: String(position),
    }),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
