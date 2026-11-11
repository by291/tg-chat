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
  await first.saveDraft({
    destination: 'saved',
    draft: firstEdit,
    expectedId: original.id,
  });
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

it('restores destination batches and acknowledges one without clearing its draft', async () => {
  const key = crypto.randomUUID();
  const first = new PendingMessages({ key });
  await first.open();
  const conversationId = crypto.randomUUID();
  const draft = { id: 'preserved', value: { text: 'My draft' } };
  await first.saveDraft({ destination: `conversation:${conversationId}`, draft });
  const item = { source_message_id: crypto.randomUUID(), message_id: crypto.randomUUID() };
  const firstDestination = {
    operation_id: crypto.randomUUID(),
    destination: { kind: 'conversation' as const, conversation_id: conversationId },
    items: [item],
  };
  const secondDestination = {
    operation_id: crypto.randomUUID(),
    destination: { kind: 'saved' as const },
    items: [{ ...item, message_id: crypto.randomUUID() }],
  };
  await first.rememberForwards([firstDestination, secondDestination]);

  const reopened = new PendingMessages({ key });
  const snapshot = await reopened.open();
  expect(snapshot.forwards?.map(({ request }) => request)).toEqual([
    firstDestination,
    secondDestination,
  ]);
  await reopened.removeForward(firstDestination.operation_id);

  const reconciled = await reopened.read();
  expect(reconciled.forwards?.map(({ request }) => request)).toEqual([secondDestination]);
  expect(reconciled.drafts[`conversation:${conversationId}`]).toEqual(draft);
});

it('scrubs edited and unavailable reply quotes from active and recovered drafts', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  const original = {
    id: 'first',
    value: { text: 'First local text' },
    reply: { message_id: 'source', quote: 'Old excerpt' },
  };
  const competing = {
    ...original,
    id: 'second',
    value: { text: 'Second local text' },
  };
  await store.saveDraft({ destination: 'saved', draft: original });
  await store.saveDraft({ destination: 'saved', draft: competing });

  await store.scrubReplyQuote({ messageId: 'source', text: 'Replacement' });
  const edited = await store.read();
  expect(edited.drafts.saved.reply?.quote).toBeNull();
  expect(edited.drafts.saved.isReplyUnavailable).not.toBe(true);
  expect(edited.draftAlternatives?.saved[0].reply?.quote).toBeNull();

  await store.redactReply('source');
  const removed = await store.read();
  expect(removed.drafts.saved.value.text).toBe('Second local text');
  expect(removed.drafts.saved.isReplyUnavailable).toBe(true);
  expect(removed.draftAlternatives?.saved[0].value.text).toBe('First local text');
  expect(removed.draftAlternatives?.saved[0].isReplyUnavailable).toBe(true);
});

it('keeps the first prepared wire payload when another tab prepares or retries the same send', async () => {
  const key = crypto.randomUUID();
  const first = new PendingMessages({ key });
  const second = new PendingMessages({ key });
  await first.open();
  await second.open();
  const queued = { ...pending(), isPrepared: false };
  await first.enqueue({ message: queued });
  const prepared = {
    ...queued,
    isPrepared: true,
    request: { ...queued.request, draft_version: '1' },
  };
  await first.updatePending(prepared);
  const competing = {
    ...prepared,
    request: { ...prepared.request, draft_version: '2' },
  };
  const adopted = await second.updatePending(competing);
  expect(adopted?.request.draft_version).toBe('1');

  await second.updatePending(queued);
  const restored = await first.read();
  expect(restored.pending[0].request.draft_version).toBe('1');
  expect(restored.pending[0].isPrepared).toBe(true);
});

it('recovers an ambiguous community action with its original identity across reloads', async () => {
  const key = crypto.randomUUID();
  const first = new PendingMessages({ key });
  await first.open();
  const operation = {
    kind: 'command' as const,
    createdAt: Date.now(),
    request: {
      operation_id: crypto.randomUUID(),
      conversation_id: 'community',
      action: { kind: 'leave' as const },
    },
  };
  await first.rememberCommunity(operation);
  const restored = new PendingMessages({ key });
  await restored.open();
  const retried = await restored.rememberCommunity({
    ...operation,
    request: { ...operation.request, operation_id: crypto.randomUUID() },
  });
  expect(retried.request.operation_id).toBe(operation.request.operation_id);
  await restored.removeCommunity(retried.request.operation_id);
  expect((await first.read()).communities).toEqual([]);
  await first.invalidate();
  await expect(restored.rememberCommunity(operation)).rejects.toThrow();
});

describe('pending media ownership', () => {
  it('fences a competing tab and discards late checkpoints after cancellation', async () => {
    const key = crypto.randomUUID();
    const first = new PendingMessages({ key });
    const second = new PendingMessages({ key });
    await first.open();
    await second.open();
    const message = pending();
    const source = {
      occurrenceId: crypto.randomUUID(),
      uploadId: crypto.randomUUID(),
      filename: 'note.txt',
      kind: 'document' as const,
      sizeBytes: 4,
      blob: new Blob(['note']),
    };
    const messageId = message.request.message_id;
    await first.enqueue({ message: { ...message, media: [source] } });

    const claim = await first.claimMedia({ messageId });
    expect(claim).toBeDefined();
    expect(await second.claimMedia({ messageId })).toBeUndefined();
    await second.remove(messageId);

    const late = await first.checkpointMedia({
      messageId,
      token: claim!.token,
      item: { ...source, fileId: crypto.randomUUID() },
    });
    expect(late).toBeUndefined();
    expect((await second.read()).pending).toEqual([]);
  });
});

it('does not write expired source bytes back from a late checkpoint', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  const message = pending();
  const source = {
    occurrenceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    filename: 'expired.txt',
    kind: 'document' as const,
    sizeBytes: 4,
    blob: new Blob(['data']),
    sourceSavedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
  };
  const messageId = message.request.message_id;
  await store.enqueue({ message: { ...message, media: [source] } });
  const claim = await store.claimMedia({ messageId });
  expect(claim).toBeDefined();
  await store.pruneMedia();

  await store.checkpointMedia({
    messageId,
    token: claim!.token,
    item: source,
  });
  const restored = await store.read();
  expect(restored.pending[0].media?.[0].blob).toBeUndefined();
  expect(restored.pending[0].media?.[0].uploadId).toBe(source.uploadId);
});

it('restarts a confirmed rejection without losing the caption or upload identity', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  const message = pending();
  const media = {
    occurrenceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    filename: 'expired.txt',
    kind: 'document' as const,
    sizeBytes: 4,
    fileId: crypto.randomUUID(),
    blob: new Blob(['data']),
  };
  await store.enqueue({
    message: {
      ...message,
      status: 'failed',
      isPrepared: true,
      canRestartMedia: true,
      media: [media],
    },
  });

  const restarted = await store.restartMedia(message.request.message_id);
  expect(restarted?.request.message_id).not.toBe(message.request.message_id);
  expect(restarted?.request.operation_id).not.toBe(message.request.operation_id);
  expect(restarted?.request.content.text).toBe(message.request.content.text);
  expect(restarted?.media?.[0].uploadId).toBe(media.uploadId);
  expect(restarted?.media?.[0].fileId).toBeUndefined();
  expect((await store.read()).pending).toHaveLength(1);
});
