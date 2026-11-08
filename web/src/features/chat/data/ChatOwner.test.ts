// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { ChatOwner } from './ChatOwner';
import { PendingMessages } from './pendingMessages';

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'alice',
  display_name: 'Alice',
  biography: '',
  phone: null,
  email: null,
  is_operator: false,
  version: '1',
};
const SAVED: components['schemas']['ConversationView'] = {
  id: '00000000-0000-4000-8000-000000000003',
  kind: 'saved',
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
};

function fixture(options: {
  transport?: (request: Request) => Promise<Response>;
  store?: PendingMessages;
  sessionId?: string;
  history?: () => Promise<Response>;
}) {
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const session = new SessionOwner({
    baseUrl: 'http://localhost:8080',
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/bootstrap')) {
        return Response.json({
          deployment_id: 'test-deployment',
          user: USER,
          privacy: { direct_messages: 'everyone', calls: 'contacts', presence: 'contacts' },
          contacts: [],
          blocks: [],
          conversations: [SAVED],
          cursor: 'initial-cursor',
        });
      }
      if (path.endsWith('/history')) {
        if (options.history) {
          return options.history();
        }
        return Response.json({
          messages: [],
          preceding_message: null,
          has_older: false,
          has_newer: false,
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
  const owner = new ChatOwner({ session, store: options.store });
  return { owner, session };
}

function receipt(request: components['schemas']['SendMessage']) {
  return {
    conversation: { ...SAVED, last_sequence: '1', version: '2' },
    message: {
      id: request.message_id,
      conversation_id: SAVED.id,
      author_id: USER.id,
      author_name: USER.display_name,
      sequence: '1',
      version: '1',
      created_at: '2026-11-09T00:00:01Z',
      content: request.content,
    },
  };
}

describe('connected chat ownership', () => {
  it('retries an ambiguous send with stable identity after reload and reconciles one row', async () => {
    const storeKey = crypto.randomUUID();
    const accepted: components['schemas']['SendMessage'][] = [];
    const first = fixture({
      store: new PendingMessages({ key: storeKey }),
      transport: async (request) => {
        accepted.push(await request.json());
        throw new TypeError('Response disappeared after commit');
      },
    });
    await first.owner.start();
    await first.owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await first.owner.queueSend({ text: 'Still exactly once' });
    await first.owner.flush();
    expect(first.owner.getSnapshot().pending).toHaveLength(1);
    first.owner.dispose();
    const restored = fixture({
      store: new PendingMessages({ key: storeKey }),
      transport: async (request) => {
        const input = await request.json();
        accepted.push(input);
        return Response.json(receipt(input));
      },
    });
    await restored.owner.start();
    await restored.owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await restored.owner.flush();
    expect(accepted[0]).toEqual(accepted[1]);
    expect(restored.owner.getSnapshot().pending).toHaveLength(0);
    expect(restored.owner.getSnapshot().messages).toHaveLength(1);
    restored.owner.dispose();
  });

  it('does not submit when persistence fails and keeps the draft available', async () => {
    const store = new PendingMessages({ key: crypto.randomUUID() });
    let submissions = 0;
    const { owner } = fixture({
      store,
      transport: async () => {
        submissions += 1;
        return Response.json({});
      },
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.setDraft({ text: 'Do not lose this' });
    await store.invalidate();
    await expect(owner.queueSend({ text: 'Do not lose this' })).rejects.toThrow();
    expect(submissions).toBe(0);
    expect(owner.getSnapshot().draft.value.text).toBe('Do not lose this');
    owner.dispose();
  });

  it('fences an outstanding acknowledgement when the account logs out', async () => {
    let release: (response: Response) => void = () => undefined;
    const delayed = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let submitted: components['schemas']['SendMessage'] | undefined;
    const store = new PendingMessages({ key: crypto.randomUUID() });
    const { owner, session } = fixture({
      store,
      transport: async (request) => {
        submitted = await request.json();
        return delayed;
      },
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.queueSend({ text: 'Private operation' });
    const sending = owner.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.invalidate({ shouldBroadcast: false });
    release(Response.json(receipt(submitted!)));
    await sending;
    expect(owner.getSnapshot().pending).toHaveLength(0);
    expect(owner.getSnapshot().messages).toHaveLength(0);
    await expect(store.read()).rejects.toThrow();
    owner.dispose();
  });
  it('ignores a delayed history page after selecting a different recipient', async () => {
    let release: (response: Response) => void = () => undefined;
    const delayed = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { owner } = fixture({ history: () => delayed });
    await owner.start();
    const previous = owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await owner.select({
      destination: { kind: 'recipient', user_id: 'another-user' },
      title: 'Other',
    });
    release(
      Response.json({
        messages: [],
        preceding_message: null,
        has_older: true,
        has_newer: false,
      }),
    );
    await previous;
    expect(owner.getSnapshot().selection?.title).toBe('Other');
    expect(owner.getSnapshot().isLoading).toBe(false);
    expect(owner.getSnapshot().hasOlder).toBe(false);
    owner.dispose();
  });

  it('stops automatic replay after seven days without dropping the pending content', async () => {
    const store = new PendingMessages({ key: crypto.randomUUID() });
    await store.open();
    await store.enqueue({
      message: {
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        status: 'queued',
        request: {
          operation_id: crypto.randomUUID(),
          message_id: crypto.randomUUID(),
          destination: { kind: 'saved' },
          content: { schema_version: 1, text: 'Old operation', rich_text: null, custom_emoji: [] },
        },
      },
    });
    let submissions = 0;
    const { owner } = fixture({
      store,
      transport: async () => {
        submissions += 1;
        return Response.json({});
      },
    });
    await owner.start();
    await owner.flush();
    expect(submissions).toBe(0);
    expect(owner.getSnapshot().pending[0].status).toBe('failed');
    expect(owner.getSnapshot().pending[0].request.content.text).toBe('Old operation');
    owner.dispose();
  });
});
