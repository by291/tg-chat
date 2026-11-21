import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import { PendingMessages } from '@/features/chat/data/pendingMessages';
import { conversationFixture } from '@/features/chat/data/messageFixtures.test-support';
import { CommunityOperations } from './CommunityOperations';
import { conversationDestination } from './communityModels';

it('selects shared history by conversation while retaining direct recipient draft ownership', () => {
  const shared = conversationFixture({
    kind: 'group',
    id: 'group',
    peer_id: 'owner',
  });
  expect(conversationDestination(shared)).toEqual({
    kind: 'conversation',
    conversation_id: 'group',
  });
  const direct = conversationFixture({ kind: 'direct', peer_id: 'recipient' });
  expect(conversationDestination(direct)).toEqual({ kind: 'recipient', user_id: 'recipient' });
});

it('recovers the original create identity after an uncertain response and reload', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  const post = vi.fn().mockRejectedValueOnce(new TypeError('Network response lost'));
  const session = { client: { POST: post } } as unknown as SessionOwner;
  const options = {
    session,
    store,
    currentEpoch: () => 'initial-epoch',
    applyReceipt: async () => undefined,
  };
  const first = new CommunityOperations(options);
  const settings = {
    title: 'Durable community',
    kind: 'group',
    description: '',
    is_public: false,
    requires_approval: false,
  };
  const remembered = vi.fn();
  const admitted = vi.fn();
  first.observeCreation(admitted);
  await expect(first.create(settings, remembered)).rejects.toThrow('Network response lost');
  const persisted = first.getSnapshot()[0];
  const identity = {
    operationId: persisted.request.operation_id,
    conversationId: persisted.request.conversation_id,
  };
  expect(remembered).toHaveBeenCalledWith(identity);
  expect(admitted).not.toHaveBeenCalled();

  const recovered = new CommunityOperations(options);
  recovered.observeCreation(admitted);
  const replayIdentity = vi.fn();
  const receipt = { observation_cursor: 'cursor', conversation: conversationFixture() };
  post.mockResolvedValueOnce({ data: receipt, response: new Response() });
  await expect(recovered.create(settings, replayIdentity)).resolves.toEqual(receipt);
  expect(replayIdentity).toHaveBeenCalledWith(identity);
  expect(admitted).toHaveBeenCalledWith({ ...identity, outcome: 'confirmed' });
  expect(post.mock.calls[1][1].body).toEqual(persisted.request);
  expect((await store.read()).communities).toEqual([]);
});

it('retains an unreadable create receipt until the server rejects the request', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  const post = vi.fn().mockResolvedValueOnce({ response: new Response(null, { status: 204 }) });
  const operations = new CommunityOperations({
    session: { client: { POST: post } } as unknown as SessionOwner,
    store,
    currentEpoch: () => 'epoch',
    applyReceipt: async () => undefined,
  });
  const reported = vi.fn();
  operations.observeCreation(reported);
  const settings = {
    title: 'Readers',
    kind: 'group',
    description: '',
    is_public: false,
    requires_approval: false,
  };
  await expect(operations.create(settings)).rejects.toThrow('invalid response');
  expect(reported).not.toHaveBeenCalled();
  const original = post.mock.calls[0][1].body;

  post.mockRejectedValueOnce(
    new ApiError({
      code: 'validation_failed',
      message: 'Choose a different handle.',
      status: 400,
    }),
  );
  await expect(operations.retry(original.operation_id)).rejects.toThrow('different handle');
  expect(post.mock.calls[1][1].body).toEqual(original);
  expect(reported).toHaveBeenCalledWith({
    operationId: original.operation_id,
    conversationId: original.conversation_id,
    outcome: 'rejected',
  });
  expect((await store.read()).communities).toEqual([]);
});

it('keeps an expired uncertain action available for review without replaying it', async () => {
  const store = new PendingMessages({ key: crypto.randomUUID() });
  await store.open();
  const request = {
    operation_id: crypto.randomUUID(),
    conversation_id: crypto.randomUUID(),
    action: { kind: 'leave' as const },
  };
  await store.rememberCommunity({
    kind: 'command',
    request,
    createdAt: 0,
  });
  const post = vi.fn();
  const operations = new CommunityOperations({
    session: { client: { POST: post } } as unknown as SessionOwner,
    store,
    currentEpoch: () => 'epoch',
    applyReceipt: async () => undefined,
  });
  await expect(operations.retry(request.operation_id)).rejects.toThrow('Review current membership');
  expect(post).not.toHaveBeenCalled();
  expect(operations.getSnapshot()).toHaveLength(1);
  await operations.dismiss(request.operation_id);
  expect(operations.getSnapshot()).toEqual([]);
});
