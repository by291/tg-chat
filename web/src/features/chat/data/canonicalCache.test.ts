// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalCache } from './canonicalCache';
import {
  canonicalFixture,
  conversationFixture,
  cursorFixture,
} from './messageFixtures.test-support';

function bootstrap() {
  return { cursor: cursorFixture(0), conversations: [conversationFixture()] };
}

function history() {
  return {
    messages: [canonicalFixture()],
    preceding_message: null,
    has_older: false,
    has_newer: false,
    generation: '1',
    observation_cursor: cursorFixture(0),
  };
}

function deletion() {
  return {
    groups: [
      {
        position: '1',
        conversation_id: 'conversation',
        conversation: conversationFixture({ version: '2', summary_text: '' }),
        removed_message_id: 'message-1',
      },
    ],
    cursor: cursorFixture(1),
    observation_cursor: cursorFixture(1),
    has_more: false,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('atomic canonical checkpoints', () => {
  it('rejects old tab writes and late history after an applied deletion', async () => {
    const key = crypto.randomUUID();
    const first = new CanonicalCache({ key });
    const second = new CanonicalCache({ key });
    const initial = await first.open(bootstrap());
    const oldTab = await second.open(bootstrap());
    expect(
      await first.saveHistory({
        expected: initial,
        conversationId: 'conversation',
        page: history(),
      }),
    ).toBe(true);
    expect(await first.applySync({ expected: initial, page: deletion() })).toBe(true);
    expect(
      await second.saveHistory({
        expected: oldTab,
        conversationId: 'conversation',
        page: history(),
      }),
    ).toBe(false);
    const current = await second.read();
    expect(current.cursor).toBe(cursorFixture(1));
    expect(current.pages.conversation.messages).toEqual([]);
    expect(
      await second.saveHistory({
        expected: current,
        conversationId: 'conversation',
        page: history(),
      }),
    ).toBe(false);
  });

  it('leaves the durable checkpoint unchanged when IndexedDB rejects the transaction', async () => {
    const cache = new CanonicalCache({ key: crypto.randomUUID() });
    const initial = await cache.open(bootstrap());
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    });
    await expect(cache.applySync({ expected: initial, page: deletion() })).rejects.toThrow();
    put.mockRestore();
    expect((await cache.read()).cursor).toBe(initial.cursor);
  });

  it('fences pre-reset responses and invalidated session writers', async () => {
    const cache = new CanonicalCache({ key: crypto.randomUUID() });
    const initial = await cache.open(bootstrap());
    await cache.reset({ expected: initial, bootstrap: bootstrap() });
    expect(await cache.applySync({ expected: initial, page: deletion() })).toBe(false);
    const current = await cache.read();
    expect(current.epoch).not.toBe(initial.epoch);
    await cache.invalidate();
    await expect(cache.applySync({ expected: current, page: deletion() })).rejects.toThrow();
  });

  it('evicts history pages within the budget while retaining directory and checkpoint state', async () => {
    const cache = new CanonicalCache({ key: crypto.randomUUID() });
    const conversations = Array.from({ length: 8 }, (_, index) =>
      conversationFixture({ id: `chat-${index}` }),
    );
    const initial = await cache.open({ ...bootstrap(), conversations });
    for (const conversation of conversations) {
      const page = history();
      page.messages = [canonicalFixture({ conversation_id: conversation.id })];
      await cache.saveHistory({
        expected: initial,
        conversationId: conversation.id,
        page,
      });
    }
    const persisted = await cache.read();
    expect(Object.keys(persisted.pages).length).toBeLessThanOrEqual(3);
    expect(persisted.conversations).toHaveLength(8);
    expect(persisted.cursor).toBe(initial.cursor);
  });
});

it('retains removal fences even when the affected history page has been evicted', async () => {
  const cache = new CanonicalCache({ key: crypto.randomUUID() });
  const initial = await cache.open(bootstrap());
  await cache.applySync({ expected: initial, page: deletion() });
  const current = await cache.read();
  expect(current.removedMessages['message-1']).toBe('conversation');
});
