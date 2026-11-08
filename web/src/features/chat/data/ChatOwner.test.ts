// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { ChatOwner } from './ChatOwner';
import { PendingMessages } from './pendingMessages';
import { cursorFixture } from './messageFixtures.test-support';

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
  keep_archived: false,
  expiry_days: 0,
  peer_read_through: '0',
  draft: { version: '0' },
};

function fixture(options: {
  transport?: (request: Request) => Promise<Response>;
  store?: PendingMessages;
  sessionId?: string;
  history?: (request: Request) => Promise<Response>;
  commands?: (request: Request) => Promise<Response>;
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
          privacy: {
            direct_messages: 'everyone',
            calls: 'contacts',
            presence: 'contacts',
          },
          contacts: [],
          blocks: [],
          conversations: [SAVED],
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
  const owner = new ChatOwner({ session, store: options.store });
  return { owner, session };
}

function receipt(request: components['schemas']['SendMessage']) {
  return {
    observation_cursor: cursorFixture(1),
    conversation: {
      ...SAVED,
      last_sequence: '1',
      version: '2',
    },
    message: {
      id: request.message_id,
      conversation_id: SAVED.id,
      author_id: USER.id,
      author_name: USER.display_name,
      sequence: '1',
      version: '1',
      interaction_version: '1',
      is_deleted: false,
      is_pinned: false,
      reactions: [],
      created_at: '2026-11-09T00:00:01Z',
      content: request.content,
    },
  };
}

function deferredResponse() {
  let release: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function historyMessage(sequence: number): components['schemas']['CanonicalMessage'] {
  return {
    id: `message-${sequence}`,
    conversation_id: SAVED.id,
    author_id: USER.id,
    author_name: USER.display_name,
    sequence: String(sequence),
    version: '1',
    interaction_version: '1',
    is_deleted: false,
    is_pinned: false,
    reactions: [],
    created_at: '2026-11-09T00:00:00Z',
    content: {
      schema_version: 1,
      text: `Message ${sequence}`,
      rich_text: null,
      custom_emoji: [],
    },
  };
}

function historyPage(options: { first: number; last: number; hasNewer?: boolean }) {
  const messages = Array.from({ length: options.last - options.first + 1 }, (_, index) => {
    return historyMessage(options.first + index);
  });
  return Response.json({
    messages,
    preceding_message: options.first > 1 ? historyMessage(options.first - 1) : null,
    has_older: options.first > 1,
    has_newer: options.hasNewer ?? false,
    generation: '1',
    observation_cursor: cursorFixture(options.last),
  });
}

function syncPage(options: { first: number; last: number }) {
  const groups = Array.from({ length: options.last - options.first + 1 }, (_, index) => {
    const sequence = options.first + index;
    return {
      position: String(sequence),
      conversation_id: SAVED.id,
      conversation: {
        ...SAVED,
        version: String(options.last),
        last_sequence: String(options.last),
      },
      message: historyMessage(sequence),
    };
  });
  return Response.json({
    groups,
    cursor: cursorFixture(options.last),
    observation_cursor: cursorFixture(options.last),
    has_more: false,
  });
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
          content: {
            schema_version: 1,
            text: 'Old operation',
            rich_text: null,
            custom_emoji: [],
          },
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
  it('keeps sync messages consumed while an older view is loading its latest snapshot', async () => {
    const latest = deferredResponse();
    let latestRequests = 0;
    const { owner } = fixture({
      history: async (request) => {
        if (new URL(request.url).searchParams.has('before')) {
          return historyPage({
            first: 101,
            last: 150,
            hasNewer: true,
          });
        }
        latestRequests += 1;
        return latestRequests === 1 ? historyPage({ first: 151, last: 200 }) : latest.promise;
      },
      transport: async () => syncPage({ first: 201, last: 201 }),
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.loadHistory('older');
    const loading = owner.loadHistory('latest');
    await owner.catchUp();
    latest.release(historyPage({ first: 151, last: 200 }));
    await loading;
    expect(owner.getSnapshot().messages.at(-1)?.sequence).toBe('201');
    expect(owner.getSnapshot().hasNewer).toBe(false);
    owner.dispose();
  });

  it('preserves a continuous older window when sync arrives at the 200-message boundary', async () => {
    const older = deferredResponse();
    let syncRequests = 0;
    const { owner } = fixture({
      history: async (request) => {
        return new URL(request.url).searchParams.has('before')
          ? older.promise
          : historyPage({ first: 101, last: 200 });
      },
      transport: async () => {
        syncRequests += 1;
        return syncRequests === 1
          ? syncPage({ first: 201, last: 300 })
          : syncPage({ first: 301, last: 301 });
      },
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.catchUp();
    const loading = owner.loadHistory('older');
    await owner.catchUp();
    older.release(
      historyPage({
        first: 51,
        last: 100,
        hasNewer: true,
      }),
    );
    await loading;
    const sequences = owner.getSnapshot().messages.map((message) => Number(message.sequence));
    expect(sequences).toEqual(Array.from({ length: 200 }, (_, index) => index + 51));
    expect(owner.getSnapshot().hasNewer).toBe(true);
    owner.dispose();
  });

  it('does not recreate a discarded operation after a delayed permanent send failure', async () => {
    const response = deferredResponse();
    const store = new PendingMessages({ key: crypto.randomUUID() });
    const { owner } = fixture({ store, transport: async () => response.promise });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.queueSend({ text: 'Removed while sending' });
    const sending = owner.flush();
    const messageId = owner.getSnapshot().pending[0].request.message_id;
    await owner.discard(messageId);
    response.release(
      Response.json(
        {
          error: {
            code: 'conversation_unavailable',
            message: 'Conversation unavailable',
            request_id: 'test',
          },
        },
        { status: 409 },
      ),
    );
    await sending;
    expect(owner.getSnapshot().pending).toHaveLength(0);
    expect((await store.read()).pending).toHaveLength(0);
    owner.dispose();
  });

  it('allows one explicit expired retry without resetting identity or automatic retry age', async () => {
    const store = new PendingMessages({ key: crypto.randomUUID() });
    await store.open();
    const request: components['schemas']['SendMessage'] = {
      operation_id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
      destination: { kind: 'saved' },
      content: {
        schema_version: 1,
        text: 'An old ambiguous operation',
        rich_text: null,
        custom_emoji: [],
      },
    };
    const createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await store.enqueue({
      message: {
        request,
        createdAt,
        status: 'queued',
      },
    });
    const submitted: unknown[] = [];
    const { owner } = fixture({
      store,
      transport: async (submission) => {
        submitted.push(await submission.json());
        throw new TypeError('Still unavailable');
      },
    });
    await owner.start();
    await owner.flush();
    await owner.retry(request.message_id);
    expect(submitted).toEqual([request]);
    await owner.flush();
    expect(submitted).toHaveLength(1);
    expect((await store.read()).pending[0].createdAt).toBe(createdAt);
    owner.dispose();
  });
  it('does not splice an older sync backlog into a newer fetched history window', async () => {
    let syncRequests = 0;
    const { owner } = fixture({
      history: async () => historyPage({ first: 251, last: 300 }),
      transport: async () => {
        syncRequests += 1;
        if (syncRequests > 1) {
          throw new TypeError('Catch-up was interrupted');
        }
        const page = await syncPage({ first: 1, last: 100 }).json();
        page.has_more = true;
        page.observation_cursor = cursorFixture(300);
        for (const group of page.groups) {
          group.conversation.last_sequence = '300';
          group.conversation.version = '300';
        }
        return Response.json(page);
      },
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await expect(owner.catchUp()).rejects.toThrow();
    const messages = owner.getSnapshot().messages;
    expect(messages).toHaveLength(50);
    expect(messages[0].sequence).toBe('251');
    expect(messages.at(-1)?.sequence).toBe('300');
    expect(owner.getSnapshot().hasNewer).toBe(false);
    owner.dispose();
  });
  it('refreshes latest history when an accepted send jumps beyond the visible sequence edge', async () => {
    let historyRequests = 0;
    const newest = deferredResponse();
    const { owner } = fixture({
      history: async () => {
        historyRequests += 1;
        return historyRequests === 1 ? historyPage({ first: 251, last: 300 }) : newest.promise;
      },
      transport: async (submission) => {
        const accepted = receipt(await submission.json());
        accepted.message.sequence = '501';
        accepted.conversation.last_sequence = '501';
        accepted.conversation.version = '501';
        return Response.json(accepted);
      },
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.queueSend({ text: 'After a busy conversation' });
    await owner.flush();
    expect(owner.getSnapshot().messages.at(-1)?.sequence).toBe('300');
    expect(owner.getSnapshot().hasNewer).toBe(true);
    newest.release(historyPage({ first: 452, last: 501 }));
    await expect.poll(() => owner.getSnapshot().messages.at(-1)?.sequence).toBe('501');
    expect(owner.getSnapshot().messages[0].sequence).toBe('452');
    expect(owner.getSnapshot().hasNewer).toBe(false);
    owner.dispose();
  });

  it('retains sender-group context when the bounded latest window evicts its first message', async () => {
    let syncRequests = 0;
    const { owner } = fixture({
      history: async () => historyPage({ first: 1, last: 100 }),
      transport: async () => {
        syncRequests += 1;
        return syncRequests === 1
          ? syncPage({ first: 101, last: 200 })
          : syncPage({ first: 201, last: 201 });
      },
    });
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    await owner.catchUp();
    await owner.catchUp();
    expect(owner.getSnapshot().messages[0].sequence).toBe('2');
    expect(owner.getSnapshot().precedingMessage?.sequence).toBe('1');
    owner.dispose();
  });
});

describe('sync invalidation fences', () => {
  it('does not resurrect a deleted message from a page requested before the deletion', async () => {
    const delayed = deferredResponse();
    const { owner } = fixture({
      history: () => delayed.promise,
      transport: async () =>
        Response.json({
          groups: [
            {
              position: '1',
              conversation_id: SAVED.id,
              conversation: { ...SAVED, version: '2' },
              removed_message_id: 'message-1',
            },
          ],
          cursor: cursorFixture(1),
          observation_cursor: cursorFixture(1),
          has_more: false,
        }),
    });
    await owner.start();
    const selecting = owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await owner.catchUp();
    delayed.release(
      Response.json({
        messages: [historyMessage(1)],
        preceding_message: null,
        has_older: false,
        has_newer: false,
        generation: '1',
        observation_cursor: cursorFixture(0),
      }),
    );
    await selecting;
    expect(owner.getSnapshot().messages).toEqual([]);
    owner.dispose();
  });
});

it('full reset fences an old page and preserves text typed before the reset', async () => {
  const delayed = deferredResponse();
  let historyRequests = 0;
  const { owner } = fixture({
    history: async () => {
      historyRequests += 1;
      return historyRequests === 1 ? delayed.promise : historyPage({ first: 2, last: 2 });
    },
    transport: async () =>
      Response.json(
        {
          error: {
            code: 'sync_reset_required',
            message: 'A fresh bootstrap is required.',
            request_id: 'reset-request',
          },
        },
        { status: 409 },
      ),
  });
  await owner.start();
  const selecting = owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await owner.setDraft({ text: 'Keep my unsent text' });
  await owner.catchUp();
  delayed.release(historyPage({ first: 1, last: 1 }));
  await selecting;
  expect(owner.getSnapshot().messages.map((message) => message.id)).toEqual(['message-2']);
  expect(owner.getSnapshot().draft.value.text).toBe('Keep my unsent text');
  owner.dispose();
});

it('keeps active local typing and exposes the competing server draft', async () => {
  const { owner } = fixture({
    commands: async () =>
      Response.json(
        {
          error: {
            code: 'message_conflict',
            message: 'Draft changed',
            request_id: 'conflict',
          },
          current: {
            observation_cursor: cursorFixture(2),
            conversation: {
              ...SAVED,
              version: '2',
              draft: {
                version: '1',
                content: {
                  schema_version: 1,
                  text: 'Another device',
                  custom_emoji: [],
                },
              },
            },
          },
        },
        { status: 409 },
      ),
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await owner.setDraft({ text: 'My active text' });
  await owner.flushDraft();
  expect(owner.getSnapshot().draft.value.text).toBe('My active text');
  expect(owner.getSnapshot().draftConflict?.value.text).toBe('Another device');
  owner.dispose();
});

it('preserves typing made while a draft save is awaiting acknowledgement', async () => {
  const delayed = deferredResponse();
  const { owner } = fixture({ commands: () => delayed.promise });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await owner.setDraft({ text: 'First draft' });
  const saving = owner.flushDraft();
  await owner.setDraft({ text: 'New typing' });
  delayed.release(
    Response.json({
      observation_cursor: cursorFixture(1),
      conversation: {
        ...SAVED,
        version: '2',
        draft: {
          version: '1',
          content: {
            schema_version: 1,
            text: 'First draft',
            custom_emoji: [],
          },
        },
      },
    }),
  );
  await saving;
  expect(owner.getSnapshot().draft.value.text).toBe('New typing');
  expect(owner.getSnapshot().draft.serverVersion).toBe('1');
  expect(owner.getSnapshot().draft.hasLocalChanges).toBe(true);
  owner.dispose();
});

it('marks only a reached visible message read while the document is foreground', async () => {
  const actions: unknown[] = [];
  const { owner } = fixture({
    history: async () => historyPage({ first: 1, last: 3 }),
    commands: async (request) => {
      const input = await request.json();
      actions.push(input.action);
      return Response.json({
        observation_cursor: cursorFixture(1),
        conversation: {
          ...SAVED,
          read_through: input.action.through,
          version: '2',
        },
      });
    },
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await owner.markReached('message-2');
  expect(actions).toEqual([]);
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
  await owner.markReached('not-loaded');
  await owner.markReached('message-2');
  await owner.markReached('message-1');
  expect(actions).toEqual([{ kind: 'read', through: '2' }]);
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  owner.dispose();
});

it('preserves an edit draft and exposes the current message when content versions conflict', async () => {
  const current = { ...historyMessage(1), version: '2' };
  current.content.text = 'Changed remotely';
  const { owner } = fixture({
    commands: async () =>
      Response.json(
        {
          error: {
            code: 'message_conflict',
            message: 'Changed',
            request_id: 'edit-conflict',
          },
          current: {
            observation_cursor: cursorFixture(2),
            conversation: { ...SAVED, version: '2' },
            message: current,
          },
        },
        { status: 409 },
      ),
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await owner.setDraft({ text: 'Unrelated composer draft' });
  await expect(
    owner.command({
      kind: 'edit',
      message_id: current.id,
      expected_version: '1',
      content: {
        schema_version: 1,
        text: 'My edit',
        custom_emoji: [],
      },
    }),
  ).rejects.toThrow('changed on another device');
  expect(owner.getSnapshot().editConflict?.content.text).toBe('Changed remotely');
  expect(owner.getSnapshot().draft.value.text).toBe('Unrelated composer draft');
  owner.dispose();
});

it('ignores a delayed command projection after a newer removal was synchronized', async () => {
  const delayed = deferredResponse();
  const { owner } = fixture({
    history: async () => historyPage({ first: 1, last: 1 }),
    commands: () => delayed.promise,
    transport: async () =>
      Response.json({
        groups: [
          {
            position: '2',
            conversation_id: SAVED.id,
            conversation: { ...SAVED, version: '3' },
            removed_message_id: 'message-1',
          },
        ],
        cursor: cursorFixture(2),
        observation_cursor: cursorFixture(2),
        has_more: false,
      }),
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  const command = owner.command({
    kind: 'pin',
    message_id: 'message-1',
    is_pinned: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await owner.catchUp();
  delayed.release(
    Response.json({
      observation_cursor: cursorFixture(1),
      conversation: { ...SAVED, version: '2' },
      message: { ...historyMessage(1), is_pinned: true },
    }),
  );
  await command;
  expect(owner.getSnapshot().messages).toEqual([]);
  owner.dispose();
});

it('scrubs a quote already on screen when its source text changes', async () => {
  const original = historyMessage(1);
  const reply = historyMessage(2);
  reply.reply = {
    message_id: original.id,
    quote: original.content.text,
    is_unavailable: false,
  };
  const edited = {
    ...original,
    version: '2',
    content: { ...original.content, text: 'Replacement' },
  };
  const { owner } = fixture({
    history: async () =>
      Response.json({
        messages: [original, reply],
        generation: '1',
        observation_cursor: cursorFixture(0),
        has_older: false,
        has_newer: false,
      }),
    transport: async () =>
      Response.json({
        groups: [
          {
            position: '1',
            conversation_id: SAVED.id,
            conversation: SAVED,
            message: edited,
          },
        ],
        cursor: cursorFixture(1),
        observation_cursor: cursorFixture(1),
        has_more: false,
      }),
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await owner.catchUp();
  expect(owner.getSnapshot().messages[1].reply?.quote).toBeNull();
  owner.dispose();
});

it('conditionally clears a matching reply draft when the server normalizes an absent quote to null', async () => {
  let draftVersion: string | null | undefined;
  const { owner } = fixture({
    commands: async (request) => {
      const input = await request.json();
      return Response.json({
        observation_cursor: cursorFixture(1),
        conversation: {
          ...SAVED,
          version: '2',
          draft: {
            version: '1',
            content: input.action.content,
            reply: { ...input.action.reply, quote: null },
          },
        },
      });
    },
    transport: async (request) => {
      const input = await request.json();
      draftVersion = input.draft_version;
      return Response.json(receipt(input));
    },
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await owner.setReply({ message_id: 'reply-target' });
  await owner.setDraft({ text: 'Reply draft' });
  await owner.queueSend({ text: 'Reply draft' });
  await owner.flush();
  expect(draftVersion).toBe('1');
  owner.dispose();
});

it('removes visible expired content and its reply excerpt without waiting for a worker wakeup', async () => {
  const expiring = historyMessage(1);
  expiring.expires_at = new Date(Date.now() + 150).toISOString();
  const reply = historyMessage(2);
  reply.reply = {
    message_id: expiring.id,
    quote: expiring.content.text,
    is_unavailable: false,
  };
  const { owner } = fixture({
    history: async () =>
      Response.json({
        messages: [expiring, reply],
        generation: '1',
        observation_cursor: cursorFixture(0),
        has_older: false,
        has_newer: false,
      }),
  });
  await owner.start();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(owner.getSnapshot().messages.map((message) => message.id)).toEqual([reply.id]);
  expect(owner.getSnapshot().messages[0].reply?.is_unavailable).toBe(true);
  expect(owner.getSnapshot().messages[0].reply?.quote).toBeNull();
  owner.dispose();
});

it('restores the newer server draft instead of a stale acknowledged local copy', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  await store.saveDraft({
    destination: 'saved',
    draft: {
      id: 'acknowledged',
      value: { text: 'Old saved draft' },
      hasLocalChanges: false,
      serverVersion: '0',
    },
  });
  const { owner } = fixture({
    store,
    transport: async () =>
      Response.json({
        groups: [
          {
            position: '1',
            conversation_id: SAVED.id,
            conversation: {
              ...SAVED,
              version: '2',
              draft: {
                version: '1',
                content: {
                  schema_version: 1,
                  text: 'New server draft',
                  custom_emoji: [],
                },
              },
            },
          },
        ],
        cursor: cursorFixture(1),
        observation_cursor: cursorFixture(1),
        has_more: false,
      }),
  });
  await owner.start();
  await owner.catchUp();
  await owner.select({ destination: { kind: 'saved' }, title: 'Saved' });
  expect(owner.getSnapshot().draft.value.text).toBe('New server draft');
  owner.dispose();
});
