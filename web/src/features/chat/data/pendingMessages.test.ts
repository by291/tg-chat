import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PendingMessages, type PendingMessage } from './pendingMessages';

function pending(): PendingMessage {
  return {
    createdAt: Date.now(),
    status: 'queued',
    request: {
      operation_id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
      destination: { kind: 'saved' },
      content: {
        schema_version: 1,
        text: 'Remember me',
        rich_text: null,
        custom_emoji: [],
      },
    },
  };
}

describe('durable pending ownership', () => {
  it('recovers stable identities and atomically preserves a newer draft', async () => {
    const key = crypto.randomUUID();
    const store = new PendingMessages({ key });
    await store.open();
    const firstDraft = { id: 'first', value: { text: 'Remember me' } };
    await store.saveDraft({ destination: 'saved', draft: firstDraft });
    await store.saveDraft({ destination: 'saved', draft: { id: 'new', value: { text: 'Next' } } });
    const message = pending();
    await store.enqueue({ message, draft: { destination: 'saved', id: firstDraft.id } });
    const restored = new PendingMessages({ key });
    const snapshot = await restored.open();
    expect(snapshot.pending).toEqual([message]);
    expect(snapshot.drafts.saved.value.text).toBe('Next');
  });

  it('prevents stale tasks and other tabs from recreating content after logout', async () => {
    const key = crypto.randomUUID();
    const first = new PendingMessages({ key });
    const second = new PendingMessages({ key });
    await first.open();
    await second.open();
    await first.enqueue({ message: pending() });
    await first.invalidate();
    await expect(second.enqueue({ message: pending() })).rejects.toThrow();
    await expect(first.open()).rejects.toThrow();
  });

  it('rejects overflow before accepting another pending identity', async () => {
    const store = new PendingMessages({ key: crypto.randomUUID() });
    await store.open();
    for (let index = 0; index < 100; index += 1) {
      await store.enqueue({ message: pending() });
    }
    await expect(store.enqueue({ message: pending() })).rejects.toThrow('100');
    expect((await store.read()).pending).toHaveLength(100);
  });
});

it('retains both drafts when two tabs edit the same stale local revision', async () => {
  const key = crypto.randomUUID();
  const first = new PendingMessages({ key });
  const second = new PendingMessages({ key });
  await first.open();
  await second.open();
  const original = { id: 'original', value: { text: 'Original' } };
  await first.saveDraft({ destination: 'saved', draft: original });
  const firstEdit = { id: 'first-edit', value: { text: 'First tab' } };
  const secondEdit = { id: 'second-edit', value: { text: 'Second tab' } };
  await first.saveDraft({ destination: 'saved', draft: firstEdit, expectedId: original.id });
  const conflict = await second.saveDraft({
    destination: 'saved',
    draft: secondEdit,
    expectedId: original.id,
  });
  expect(conflict?.value.text).toBe('First tab');
  const persisted = await first.read();
  expect(persisted.drafts.saved.value.text).toBe('Second tab');
  expect(persisted.draftAlternatives?.saved[0].value.text).toBe('First tab');
});

it('reuses an ambiguous command identity after reload and removes only its acknowledgement', async () => {
  const key = crypto.randomUUID();
  const first = new PendingMessages({ key });
  await first.open();
  const request = {
    operation_id: crypto.randomUUID(),
    conversation_id: crypto.randomUUID(),
    action: { kind: 'clear' as const },
  };
  await first.rememberCommand(request);
  const second = new PendingMessages({ key });
  await second.open();
  const restored = await second.rememberCommand({ ...request, operation_id: crypto.randomUUID() });
  expect(restored.operation_id).toBe(request.operation_id);
  await second.removeCommand(restored.operation_id);
  expect((await first.read()).commands).toEqual([]);
});
