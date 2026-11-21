import type { components } from '@/api/schema';
import { SessionOwner } from '@/features/auth/SessionOwner';
import type { UploadTransport } from '@/features/media/uploadTransfer';
import { ChatOwner } from './ChatOwner';
import { cursorFixture } from './messageFixtures.test-support';
import type { PendingMessages } from './pendingMessages';

export const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'alice',
  display_name: 'Alice',
  biography: '',
  phone: null,
  email: null,
  is_operator: false,
  version: '1',
};
export const SAVED: components['schemas']['ConversationView'] = {
  id: '00000000-0000-4000-8000-000000000003',
  kind: 'saved',
  settings_version: '1',
  can_set_forwarding_policy: true,
  has_forwarding_consent: false,
  is_forwarding_enabled: true,
  title: '',
  description: '',
  is_public: false,
  requires_approval: false,
  role: 'member',
  can_post: true,
  can_manage: true,
  peer_id: USER.id,
  peer_name: USER.display_name,
  peer_username: USER.username,
  last_sequence: '0',
  version: '1',
  summary_text: '',
  updated_at: '2026-11-09T00:00:00Z',
  generation: '1',
  unread_count: '0',
  read_through: '0',
  clear_through: '0',
  is_archived: false,
  is_hidden: false,
  is_manually_unread: false,
  pin_rank: null,
  muted_until: null,
  keep_archived: false,
  expiry_days: 0,
  peer_read_through: '0',
  draft: { version: '0' },
};

export const DIRECT: components['schemas']['ConversationView'] = { ...SAVED, kind: 'direct' };

export const SELECTION = {
  destination: { kind: 'conversation' as const, conversation_id: DIRECT.id },
  title: 'Direct chat',
};

/** Create an authenticated chat owner with isolated storage and configurable HTTP responses. */
export function createChatOwnerFixture(options: {
  conversation?: components['schemas']['ConversationView'];
  transport?: (request: Request) => Promise<Response>;
  store?: PendingMessages;
  mediaTransport?: UploadTransport;
  sessionId?: string;
  history?: (request: Request) => Promise<Response>;
  commands?: (request: Request) => Promise<Response>;
  beforeBootstrap?: () => void;
}) {
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const session = new SessionOwner({
    baseUrl: 'http://localhost:8080',
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/bootstrap')) {
        options.beforeBootstrap?.();
        return Response.json({
          deployment_id: 'test-deployment',
          user: USER,
          privacy: {
            direct_messages: 'everyone',
            calls: 'contacts',
            presence: 'contacts',
          },
          contacts: [],
          blocks: [],
          conversations: [options.conversation ?? SAVED],
          cursor: cursorFixture(0),
        });
      }
      if (path.endsWith('/history')) {
        if (options.history) {
          return options.history(request);
        }
        return Response.json({
          messages: [],
          preceding_message: null,
          has_older: false,
          has_newer: false,
          generation: '1',
          observation_cursor: cursorFixture(0),
        });
      }
      if (path.endsWith('/commands')) {
        if (options.commands) {
          return options.commands(request);
        }
        const input = await request.json();
        const draft =
          input.action.kind === 'draft'
            ? {
                version: String(Number(input.action.expected_version) + 1),
                content: input.action.content,
                reply: input.action.reply,
              }
            : SAVED.draft;
        return Response.json({
          observation_cursor: cursorFixture(1),
          conversation: { ...SAVED, draft },
        });
      }
      return options.transport!(request);
    },
  });
  session.accept(
    {
      user: USER,
      csrf_token: 'csrf-token',
      session: {
        id: sessionId,
        device_name: 'Browser',
        created_at: '2026-11-09T00:00:00Z',
        last_seen_at: '2026-11-09T00:00:00Z',
        expires_at: '2026-12-09T00:00:00Z',
        is_current: true,
      },
    },
    { shouldBroadcast: false },
  );
  const owner = new ChatOwner({
    session,
    store: options.store,
    mediaTransport: options.mediaTransport,
  });
  return { owner, session };
}
