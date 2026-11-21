// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionOwner } from '../auth/SessionOwner';
import { ContactsPanel } from './ContactsPanel';

const CONTACT = {
  id: 'alice-id',
  display_name: 'Alice Chen',
  username: 'alice',
  biography: 'At the studio',
  avatar_file_id: 'avatar-file',
};
const SIGNED_AVATAR = 'https://media.test/signed-thumbnail';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderContacts() {
  const writes: Request[] = [];
  const owner = new SessionOwner({
    baseUrl: 'https://chat.test',
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (request.method !== 'GET') {
        writes.push(request);
        return new Response(null, { status: 204 });
      }
      if (path === '/api/v1/media/avatars/user/alice-id/thumbnail') {
        return Response.json({ url: SIGNED_AVATAR });
      }

      return Response.json({ users: [CONTACT], next_cursor: null });
    },
  });
  render(<ContactsPanel owner={owner} scope="contacts" />);
  return writes;
}

it('displays the thumbnail authorized for the visible directory user', async () => {
  renderContacts();
  const row = await screen.findByRole('listitem');
  await waitFor(() => {
    expect(row.querySelector('img')?.src).toBe(SIGNED_AVATAR);
  });
});

it.each([
  {
    action: 'Remove contact',
    title: 'Remove Alice Chen from contacts?',
    notice: 'Alice Chen removed from contacts.',
    method: 'DELETE',
    path: '/api/v1/contacts',
  },
  {
    action: 'Block',
    title: 'Block Alice Chen?',
    notice: 'Alice Chen blocked.',
    method: 'PUT',
    path: '/api/v1/blocks',
  },
])('requires confirmation for $action and names the affected contact', async (scenario) => {
  const writes = renderContacts();
  const user = userEvent.setup();
  const row = within(await screen.findByRole('listitem'));
  expect(row.queryByRole('button', { name: scenario.action })).toBeNull();

  async function chooseAction() {
    await user.click(row.getByRole('button', { name: 'Actions for Alice Chen' }));
    await user.click(await screen.findByRole('menuitem', { name: scenario.action }));
    return within(await screen.findByRole('dialog', { name: scenario.title }));
  }

  const firstConfirmation = await chooseAction();
  await user.click(firstConfirmation.getByRole('button', { name: 'Cancel' }));
  expect(writes).toHaveLength(0);

  const confirmation = await chooseAction();
  await user.click(confirmation.getByRole('button', { name: scenario.action }));
  await screen.findByText(scenario.notice);
  expect(writes).toHaveLength(1);
  const [request] = writes;
  expect(request.method).toBe(scenario.method);
  expect(new URL(request.url).pathname).toBe(scenario.path);
  expect(await request.json()).toEqual({ target_id: 'alice-id' });
});

it.each(['contacts', 'blocks'] as const)(
  'refreshes the current %s query and cursor after another surface admits a change',
  async (scope) => {
    const user = userEvent.setup();
    const nextCursor = 'second-page';
    let releaseOldPage: (response: Response) => void = () => {};
    const oldPage = new Promise<Response>((resolve) => {
      releaseOldPage = resolve;
    });
    const queries: URLSearchParams[] = [];
    let isAdmitted = false;
    const owner = new SessionOwner({
      baseUrl: 'https://chat.test',
      fetch: async (request) => {
        if (request.method === 'PUT') {
          isAdmitted = true;
          return new Response(null, { status: 204 });
        }
        const query = new URL(request.url).searchParams;
        queries.push(query);
        if (query.get('cursor') !== nextCursor) {
          return Response.json({ users: [], next_cursor: nextCursor });
        }
        if (!isAdmitted) {
          return oldPage;
        }
        return Response.json({ users: [{ ...CONTACT, avatar_file_id: null }], next_cursor: null });
      },
    });
    render(<ContactsPanel owner={owner} scope={scope} />);
    await user.type(screen.getByRole('searchbox'), 'alice');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('alice'));
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(queries.at(-1)?.get('cursor')).toBe(nextCursor));

    await act(() =>
      owner.setRelationship({
        id: CONTACT.id,
        kind: scope,
        shouldInclude: true,
      }),
    );
    expect(await screen.findByText(CONTACT.display_name)).toBeTruthy();
    expect(queries.at(-1)?.get('search')).toBe('alice');
    expect(queries.at(-1)?.get('cursor')).toBe(nextCursor);

    await act(async () => {
      releaseOldPage(Response.json({ users: [], next_cursor: null }));
      await oldPage;
    });
    expect(screen.getByText(CONTACT.display_name)).toBeTruthy();
  },
);
