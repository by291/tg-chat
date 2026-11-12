// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionOwner } from '../auth/SessionOwner';
import { PrivacyPanel } from './PrivacyPanel';

afterEach(cleanup);

it('refreshes a mounted privacy form when the account settings revision advances', async () => {
  const fetch = vi.fn();
  fetch.mockResolvedValueOnce(
    Response.json({ direct_messages: 'everyone', calls: 'contacts', presence: 'contacts' }),
  );
  fetch.mockResolvedValueOnce(
    Response.json({ direct_messages: 'nobody', calls: 'contacts', presence: 'contacts' }),
  );
  const owner = new SessionOwner({
    baseUrl: 'https://chat.example.test',
    fetch,
  });
  const form = render(<PrivacyPanel owner={owner} settingsVersion="1" />);
  await screen.findByRole('button', { name: /Messages Everyone/ });

  form.rerender(<PrivacyPanel owner={owner} settingsVersion="2" />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Messages Nobody/ })).toBeTruthy();
  });
});

it('keeps save feedback visible when the committed revision arrives through sync', async () => {
  const initialPrivacy = {
    direct_messages: 'everyone',
    calls: 'contacts',
    presence: 'contacts',
  };
  let privacy = initialPrivacy;
  const fetch = vi.fn(async (request: Request) => {
    if (request.method === 'PATCH') {
      privacy = await request.json();
    }

    return Response.json(privacy);
  });
  const owner = new SessionOwner({
    baseUrl: 'https://chat.example.test',
    fetch,
  });
  const form = render(<PrivacyPanel owner={owner} settingsVersion="1" />);
  fireEvent.click(await screen.findByRole('button', { name: /Calls My contacts/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Nobody' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Privacy settings saved.');

  form.rerender(<PrivacyPanel owner={owner} settingsVersion="2" />);

  const saved = await screen.findByRole<HTMLInputElement>('radio', { name: 'Nobody' });
  expect(saved.checked).toBe(true);
  expect(privacy.direct_messages).toBe('everyone');
  expect(screen.getByText('Privacy settings saved.')).toBeTruthy();
});
