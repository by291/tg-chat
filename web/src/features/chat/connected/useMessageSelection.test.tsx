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

  rerender({ generation: '2' });

  expect(result.current.isChoosingReportMessages).toBe(false);
  expect(result.current.selectedIds).toBeUndefined();
  expect(result.current.reportedMessageIds).toBeUndefined();
});
