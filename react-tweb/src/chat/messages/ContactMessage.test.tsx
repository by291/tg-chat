// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducer } from 'react';
import { messageMediaSchema, type ContactMedia } from '../messageMedia';
import { createInitialState } from '../demo/fixtures';
import type { ChatState } from '../model';
import { chatReducer } from '../state/reducer';
import { getConversations } from '../state/conversations';
import { parseSavedState } from '../state/storage';
import { ContactActionsProvider } from './ContactActions';
import { ContactCard } from './MessageCards';

const contact = {
  kind: 'contact' as const,
  name: 'Maya Chen',
  phone: '+1 202 555 0142',
  initials: 'MC',
};

function ContactConversation({
  media,
  initialState,
}: {
  media: ContactMedia;
  initialState?: ChatState;
}) {
  const [state, dispatch] = useReducer(chatReducer, initialState ?? createInitialState());
  const activeConversation = getConversations(state).find(
    (conversation) => conversation.id === state.activeChatId,
  );

  return (
    <ContactActionsProvider
      state={state}
      dispatch={dispatch}
      onSelectConversation={(chatId) => dispatch({ type: 'select-chat', chatId })}
    >
      <ContactCard media={media} />
      <output aria-label="Active conversation">{activeConversation?.title}</output>
      <output aria-label="Saved phone">{activeConversation?.phone}</output>
      <output aria-label="Conversation subtitle">{activeConversation?.subtitle}</output>
      <output aria-label="Conversation visibility">
        {state.conversationPreferences?.[state.activeChatId]?.isDeleted ? 'hidden' : 'visible'}
      </output>
      <output aria-label="Original group">
        {getConversations(state).find((conversation) => conversation.id === 'dev')?.kind}
      </output>
      <button
        onClick={() => {
          const restored = parseSavedState(JSON.parse(JSON.stringify(state)));
          if (restored) {
            dispatch({ type: 'restore', state: restored });
          }
        }}
      >
        Restore saved state
      </button>
    </ContactActionsProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('shared contacts', () => {
  it('identifies a registered peer without mistaking its phone for a telephone link', () => {
    const registeredContact = { ...contact, userId: 'maya' };
    render(<ContactConversation media={registeredContact} />);

    expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy phone number/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByLabelText('Active conversation').textContent).toBe('Maya Chen');
  });

  it('saves edited contact information and keeps the add action hidden after restoring state', async () => {
    render(<ContactConversation media={{ ...contact, userId: 'maya' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add Contact' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('First name').value).toBe('Maya');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Last name').value).toBe('Chen');
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'May' } });
    fireEvent.change(within(dialog).getByLabelText('Phone number'), {
      target: { value: '+1 202 555 0199' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByLabelText('Active conversation').textContent).toBe('May Chen');
    expect(screen.getByLabelText('Saved phone').textContent).toBe('+1 202 555 0199');
    expect(screen.getByLabelText('Conversation subtitle').textContent).toBe('+1 202 555 0199');
    fireEvent.click(screen.getByRole('button', { name: 'Restore saved state' }));
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.getByLabelText('Saved phone').textContent).toBe('+1 202 555 0199');
  });

  it('opens the existing private chat without replacing its saved name', () => {
    render(<ContactConversation media={{ ...contact, userId: 'alex' }} />);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat with Maya Chen' }));
    expect(screen.getByLabelText('Active conversation').textContent).toBe('Alex Morgan');
  });

  it('preserves a presence subtitle when saving an existing peer with a changed phone', async () => {
    const state = createInitialState();
    const existingPeer = getConversations(state).find(
      (conversation) => conversation.id === 'alex',
    )!;
    state.localConversations = [
      {
        ...existingPeer,
        isContact: false,
        phone: contact.phone,
      },
    ];
    render(<ContactConversation media={{ ...contact, userId: 'alex' }} initialState={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Contact' });
    fireEvent.change(within(dialog).getByLabelText('Phone number'), {
      target: { value: '+1 202 555 0199' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));

    expect(screen.getByLabelText('Saved phone').textContent).toBe('+1 202 555 0199');
    expect(screen.getByLabelText('Conversation subtitle').textContent).toBe('last seen recently');
  });

  it('restores the visibility of a deleted private conversation when Message opens it', () => {
    const state = createInitialState();
    state.activeChatId = 'alex';
    state.conversationPreferences = { alex: { isDeleted: true } };
    render(<ContactConversation media={{ ...contact, userId: 'alex' }} initialState={state} />);
    expect(screen.getByLabelText('Conversation visibility').textContent).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));

    expect(screen.getByLabelText('Active conversation').textContent).toBe('Alex Morgan');
    expect(screen.getByLabelText('Conversation visibility').textContent).toBe('visible');
  });

  it('keeps an unrelated group when a peer has the same external identifier', () => {
    render(<ContactConversation media={{ ...contact, userId: 'dev' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));

    expect(screen.getByLabelText('Active conversation').textContent).toBe('Maya Chen');
    expect(screen.getByLabelText('Original group').textContent).toBe('group');
  });

  it('opens Saved Messages for the current user without offering to add yourself', () => {
    render(<ContactConversation media={{ ...contact, userId: 'you' }} />);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByLabelText('Active conversation').textContent).toBe('Saved Messages');
  });

  it('opens registered contact details from the card while Message opens the conversation', async () => {
    render(
      <ContactConversation
        media={{
          ...contact,
          userId: 'maya',
          details: [{ type: 'email', value: 'maya@example.com' }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Contact details for Maya Chen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Contact Details' });
    expect(within(dialog).getByText('maya@example.com')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByLabelText('Active conversation').textContent).toBe('Maya Chen');
  });

  it('copies a plain contact phone number and confirms the result', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ContactCard media={contact} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy phone number for Maya Chen' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('+1 202 555 0142'));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Phone number copied');
    expect(screen.getByText('MC')).toBeTruthy();
    expect(screen.queryByText('View Contact')).toBeNull();
  });

  it('reports clipboard failures without claiming the phone was copied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ContactCard media={contact} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy phone number for Maya Chen' }));

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Could not copy phone number',
    );
  });

  it('shows all saved contact details and copies a selected field', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const detailedContact = messageMediaSchema.parse({
      ...contact,
      details: [
        {
          type: 'phone',
          value: '+1 202 555 0199',
          label: 'Work phone',
        },
        { type: 'email', value: 'maya@example.com' },
        { type: 'organization', value: 'Design Studio' },
        { type: 'address', value: '42 Garden Street' },
      ],
    });
    if (detailedContact.kind !== 'contact') {
      throw new Error('Expected a shared contact');
    }
    render(<ContactCard media={detailedContact} />);

    expect(screen.getByText('+1 202 555 0199')).toBeTruthy();
    expect(screen.queryByText(contact.phone)).toBeNull();
    expect(screen.queryByText('42 Garden Street')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View Contact' }));

    const dialog = await screen.findByRole('dialog', { name: 'Contact Details' });
    fireEvent.click(within(dialog).getByRole('button', { name: /maya@example.com/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('maya@example.com'));
    expect(within(dialog).getByText('42 Garden Street')).toBeTruthy();
    expect(within(dialog).getByText('Work phone')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Text copied');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps a contact without a phone or details readable without a dead action', () => {
    render(<ContactCard media={{ ...contact, phone: '' }} />);

    expect(screen.getByText('Maya Chen')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
