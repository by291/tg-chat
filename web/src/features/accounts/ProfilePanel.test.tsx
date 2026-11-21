// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from '../auth/SessionOwner';
import { ProfilePanel } from './ProfilePanel';

type Profile = components['schemas']['PrivateProfile'];

const PROFILE: Profile = {
  id: 'alice-id',
  username: 'alice',
  display_name: 'Alice',
  biography: 'My original biography',
  phone: null,
  is_operator: false,
  version: '1',
};

afterEach(cleanup);

function renderProfile(fetch: (request: Request) => Promise<Response>) {
  const owner = new SessionOwner({ baseUrl: 'https://chat.test', fetch });
  const panel = render(<ProfilePanel owner={owner} profile={PROFILE} />);
  return (profile: Profile) => panel.rerender(<ProfilePanel owner={owner} profile={profile} />);
}

function acceptProfileUpdate(version: string) {
  return vi.fn(async (request: Request) => {
    const changes = await request.clone().json();
    return Response.json({
      ...PROFILE,
      ...changes,
      version,
    });
  });
}

function biography() {
  return screen.getByLabelText<HTMLTextAreaElement>('Biography');
}

it('keeps a biography draft across photo changes and saves the latest clean fields', async () => {
  const fetch = acceptProfileUpdate('5');
  const receive = renderProfile(fetch);
  fireEvent.change(biography(), { target: { value: 'My new biography' } });

  receive({
    ...PROFILE,
    avatar_file_id: 'photo',
    version: '2',
  });
  expect(biography().value).toBe('My new biography');
  receive({
    ...PROFILE,
    avatar_file_id: null,
    version: '3',
  });
  expect(biography().value).toBe('My new biography');
  receive({
    ...PROFILE,
    display_name: 'Alice Updated',
    phone: '555 0123',
    version: '4',
  });
  expect(screen.getByLabelText<HTMLInputElement>('Display name').value).toBe('Alice Updated');

  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await screen.findByText('Profile saved.');
  const [request] = fetch.mock.calls[0];
  expect(await request.json()).toEqual({
    version: '4',
    display_name: 'Alice Updated',
    biography: 'My new biography',
    phone: '555 0123',
  });
});

it('requires a choice before saving over a conflicting remote biography', async () => {
  const fetch = acceptProfileUpdate('3');
  const receive = renderProfile(fetch);
  fireEvent.change(biography(), { target: { value: 'My draft' } });
  receive({
    ...PROFILE,
    biography: 'Updated elsewhere',
    version: '2',
  });

  expect(biography().value).toBe('My draft');
  expect(screen.getByRole('alert').textContent).toContain('Updated elsewhere');
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(fetch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Keep my biography' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await screen.findByText('Profile saved.');
  const [request] = fetch.mock.calls[0];
  expect(await request.json()).toMatchObject({ version: '2', biography: 'My draft' });
});

it('refreshes a rejected version while preserving independent edits for retry', async () => {
  const latest = {
    ...PROFILE,
    display_name: 'Alice Updated',
    version: '2',
  };
  const fetch = vi.fn(async (request: Request) => {
    if (request.method === 'GET') {
      return Response.json({
        user: latest,
        csrf_token: 'test-token',
        session: {
          id: 'session',
          device_name: 'Browser',
          created_at: '2026-11-01T00:00:00Z',
          expires_at: '2026-12-01T00:00:00Z',
          last_seen_at: '2026-11-21T00:00:00Z',
          is_current: true,
        },
      });
    }

    const changes = await request.json();
    if (changes.version === '2') {
      return Response.json({
        ...latest,
        ...changes,
        biography: changes.biography.trim(),
        version: '3',
      });
    }
    return Response.json(
      {
        error: {
          code: 'account_changed',
          message: 'The account has changed.',
          request_id: 'request',
        },
      },
      { status: 409 },
    );
  });
  const owner = new SessionOwner({ baseUrl: 'https://chat.test', fetch });

  function ProfileScreen() {
    const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
    return <ProfilePanel owner={owner} profile={snapshot.auth?.user ?? PROFILE} />;
  }

  render(<ProfileScreen />);
  fireEvent.change(biography(), { target: { value: ' Unsaved biography ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText<HTMLInputElement>('Display name').value).toBe('Alice Updated');
  expect(biography().value).toBe(' Unsaved biography ');

  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await screen.findByText('Profile saved.');
  expect(biography().value).toBe('Unsaved biography');
  expect(owner.getSnapshot().auth?.user.biography).toBe('Unsaved biography');
});
