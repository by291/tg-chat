// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import { ContactActionsProvider } from '@/features/chat/messages/content/contact/ContactActions';
import { ContactMessage } from '@/features/chat/messages/content/contact/ContactMessage';
import { chatReducer } from '@/features/chat/state/reducer';
import { getConversations } from '@/features/chat/state/conversations';
import { NewChatPage } from './NewChatPage';

function ContactSelectionScreen({ mode }: { mode: 'private' | 'group' }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const media = {
    kind: 'contact' as const,
    name: 'Maya Chen',
    phone: '+1 202 555 0142',
    initials: 'MC',
    userId: 'maya',
  };

  return (
    <ContactActionsProvider
      state={state}
      dispatch={dispatch}
      onSelectConversation={(chatId) => dispatch({ type: 'select-chat', chatId })}
    >
      <ContactMessage media={media} />
      <NewChatPage
        mode={mode}
        conversations={getConversations(state)}
        dispatch={dispatch}
        onBack={() => {}}
        onSelectChat={(chatId) => dispatch({ type: 'select-chat', chatId })}
      />
    </ContactActionsProvider>
  );
}

afterEach(cleanup);

describe('contact selection', () => {
  it.each(['private', 'group'] as const)(
    'keeps a messaged peer out of the %s contact picker until Add is saved',
    async (mode) => {
      render(<ContactSelectionScreen mode={mode} />);
      const title = mode === 'private' ? 'Contacts' : 'New Group';
      const picker = screen.getByRole('region', { name: title });
      fireEvent.click(screen.getByRole('button', { name: 'Message' }));

      expect(within(picker).queryByText('Maya Chen')).toBeNull();
      expect(within(picker).getByText('Alex Morgan')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add Contact' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      expect(within(picker).getByText('Maya Chen')).toBeTruthy();
    },
  );
});
