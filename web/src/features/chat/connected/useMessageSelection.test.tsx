// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChatOwner } from '../data/ChatOwner';
import { canonicalFixture } from '../data/messageFixtures.test-support';
import { useMessageSelection } from './useMessageSelection';

afterEach(cleanup);

it('discards selected report messages when the same conversation gets a new membership', () => {
  const message = canonicalFixture();
  const owner = {} as ChatOwner;
  const onError = vi.fn();
  const { result, rerender } = renderHook(
    ({ generation }) =>
      useMessageSelection({
        owner,
        messages: [message],
        authorId: 'viewer',
        canReport: true,
        selectedKey: 'conversation',
        generation,
        onError,
      }),
    { initialProps: { generation: '1' } },
  );

  act(() => result.current.startReportSelection());
  act(() => result.current.toggleSelection(message.id));
  act(() => result.current.reportSelectedMessages());
  expect(result.current.reportedMessageIds).toEqual([message.id]);
  expect(result.current.canCopySelection).toBe(false);

  rerender({ generation: '2' });

  expect(result.current.isChoosingReportMessages).toBe(false);
  expect(result.current.selectedIds).toBeUndefined();
  expect(result.current.reportedMessageIds).toBeUndefined();
});

it('copies only readable selected bodies in their current history order', async () => {
  const first = canonicalFixture();
  const second = canonicalFixture({
    id: 'second',
    content: { ...first.content, text: 'Second body' },
  });
  const removed = canonicalFixture({
    id: 'removed',
    content: { ...first.content, text: 'Revoked body' },
  });
  // prettier-ignore
  const messages = [
    first,
    second,
    removed,
  ];
  const selection = { destination: { kind: 'saved' } };
  const owner = {
    getSnapshot: () => ({ selection, messages }),
    selectedConversation: () => ({ generation: '1' }),
  } as unknown as ChatOwner;
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  try {
    const { result } = renderHook(() =>
      useMessageSelection({
        owner,
        messages,
        authorId: 'viewer',
        canReport: true,
        selectedKey: 'saved',
        generation: '1',
        onError: vi.fn(),
      }),
    );
    act(() =>
      result.current.setMessageSelection({
        // prettier-ignore
        messageIds: [
          removed.id,
          second.id,
          first.id,
        ],
        shouldSelect: true,
      }),
    );
    removed.is_deleted = true;
    await result.current.copySelectedMessages();

    expect(writeText).toHaveBeenCalledWith('Visible content\nSecond body');
  } finally {
    vi.unstubAllGlobals();
  }
});
