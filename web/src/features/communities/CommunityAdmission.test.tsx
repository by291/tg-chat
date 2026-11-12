// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { CommunityInviteLink } from './CommunityAdmission';

const INVITE_TOKEN = '32'.repeat(32);
const PREVIEW = {
  id: 'the-weekly-meetup',
  kind: 'group',
  title: 'The weekly meetup',
  requires_approval: false,
};

function fixture({
  requiresApproval = false,
  isAlreadyJoined = false,
}: { requiresApproval?: boolean; isAlreadyJoined?: boolean } = {}) {
  const conversation = { id: PREVIEW.id, title: PREVIEW.title };
  const post = vi.fn().mockResolvedValue({
    data: { ...PREVIEW, requires_approval: requiresApproval },
    response: new Response(),
  });
  const get = vi.fn().mockResolvedValue({ data: conversation, response: new Response() });
  const session = { client: { POST: post, GET: get } } as unknown as SessionOwner;
  const command = vi.fn().mockResolvedValue(requiresApproval ? {} : { conversation });
  const chat = {
    communities: { command },
    getSnapshot: () => ({ conversations: isAlreadyJoined ? [conversation] : [] }),
  } as unknown as ChatOwner;
  const onAdmitted = vi.fn();

  return { chat, command, conversation, get, onAdmitted, post, session };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('previews an invitation from the fragment and waits for explicit admission', async () => {
  window.history.replaceState(null, '', `/#invite=${INVITE_TOKEN}&other=keep`);
  const { chat, command, conversation, onAdmitted, post, session } = fixture();
  const user = userEvent.setup();

  render(<CommunityInviteLink session={session} chat={chat} onAdmitted={onAdmitted} />);

  const dialog = await screen.findByRole('dialog', { name: PREVIEW.title });
  expect(post).toHaveBeenCalledWith(
    '/api/v1/community-invitations/preview',
    expect.objectContaining({ body: { token: INVITE_TOKEN } }),
  );
  expect(command).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole('button', { name: 'Join group' }));

  expect(command).toHaveBeenCalledOnce();
  expect(command).toHaveBeenCalledWith({
    conversationId: PREVIEW.id,
    action: { kind: 'join', token: INVITE_TOKEN },
  });
  expect(onAdmitted).toHaveBeenCalledWith(conversation);
  expect(window.location.hash).toBe('#other=keep');
});

it('leaves a request awaiting approval and does not open the conversation', async () => {
  window.history.replaceState(null, '', `/#invite=${INVITE_TOKEN}`);
  const { chat, command, onAdmitted, session } = fixture({ requiresApproval: true });
  const user = userEvent.setup();

  render(<CommunityInviteLink session={session} chat={chat} onAdmitted={onAdmitted} />);

  const dialog = await screen.findByRole('dialog', { name: PREVIEW.title });
  await user.click(within(dialog).getByRole('button', { name: 'Request to join' }));
  expect(await within(dialog).findByText('Request sent. Waiting for approval.')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: 'Request to join' })).toBeNull();
  expect(command).toHaveBeenCalledOnce();
  expect(onAdmitted).not.toHaveBeenCalled();
});

it('opens a validated invitation for a current member without sending another join', async () => {
  window.history.replaceState(null, '', `/#invite=${INVITE_TOKEN}`);
  const { chat, command, conversation, get, onAdmitted, session } = fixture({
    isAlreadyJoined: true,
  });

  render(<CommunityInviteLink session={session} chat={chat} onAdmitted={onAdmitted} />);

  await waitFor(() => expect(onAdmitted).toHaveBeenCalledWith(conversation));
  expect(get).toHaveBeenCalledWith('/api/v1/communities/{conversation_id}', {
    params: { path: { conversation_id: PREVIEW.id } },
  });
  expect(command).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
});
