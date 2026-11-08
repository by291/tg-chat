// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, expect, it } from 'vitest';
import { createInitialState } from '../../chat/demo/fixtures';
import { chatReducer } from '../../chat/state/reducer';
import { useChatRoute } from './useChatRoute';

afterEach(cleanup);

function useRoutedConversation(options: { chatId: string; isReady: boolean }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  useChatRoute({
    ...options,
    state,
    dispatch,
  });
  return { state, dispatch };
}

it('waits for restoration before selecting a linked chat and clearing its unread count', () => {
  const view = renderHook(useRoutedConversation, {
    initialProps: { chatId: 'dev', isReady: false },
  });
  expect(view.result.current.state.activeChatId).toBe('');
  view.rerender({ chatId: 'dev', isReady: true });
  expect(view.result.current.state.activeChatId).toBe('dev');
  expect(view.result.current.state.conversationPreferences?.dev.unreadCount).toBe(0);
});

it('clears the selected chat for an unknown destination while preserving the draft', () => {
  const view = renderHook(useRoutedConversation, {
    initialProps: { chatId: 'dev', isReady: true },
  });
  act(() => {
    view.result.current.dispatch({
      type: 'set-draft',
      chatId: 'dev',
      text: 'Keep this draft',
    });
  });
  view.rerender({ chatId: 'missing', isReady: true });
  expect(view.result.current.state.activeChatId).toBe('');
  expect(view.result.current.state.drafts.dev).toBe('Keep this draft');
});

it('does not reopen a deleted conversation when its URL remains in browser history', () => {
  const view = renderHook(useRoutedConversation, {
    initialProps: { chatId: 'dev', isReady: true },
  });
  act(() => {
    view.result.current.dispatch({
      type: 'update-conversations',
      chatIds: ['dev'],
      changes: { isDeleted: true },
    });
  });
  expect(view.result.current.state.activeChatId).toBe('');
  expect(view.result.current.state.conversationPreferences?.dev.isDeleted).toBe(true);
});

it('keeps an explicit selection while its URL transition is pending', () => {
  const view = renderHook(useRoutedConversation, {
    initialProps: { chatId: 'dev', isReady: true },
  });
  act(() => view.result.current.dispatch({ type: 'select-chat', chatId: 'design' }));
  expect(view.result.current.state.activeChatId).toBe('design');
  view.rerender({ chatId: 'design', isReady: true });
  expect(view.result.current.state.activeChatId).toBe('design');
});
