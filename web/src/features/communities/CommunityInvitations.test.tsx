// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { hideToast } from '@/components/toastStore';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { CommunityInvitations } from './CommunityInvitations';
import type { Conversation } from './communityModels';

afterEach(() => {
  cleanup();
  hideToast();
});

it('copies a confirmed invitation with the secret only in the URL fragment', async () => {
  const get = vi.fn().mockResolvedValue({ data: { items: [] }, response: new Response() });
  const session = { client: { GET: get } } as unknown as SessionOwner;
  const conversation = { id: 'club' } as Conversation;
  const command = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();

  render(
    <CommunityInvitations
      session={session}
      conversation={conversation}
      command={command}
      confirm={vi.fn()}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Create invite link' }));
  await user.click(await screen.findByRole('button', { name: 'Copy invite link' }));

  const copied = new URL(await navigator.clipboard.readText());
  const token = new URLSearchParams(copied.hash.slice(1)).get('invite');
  expect(copied.search).toBe('');
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invite', token }));
});
