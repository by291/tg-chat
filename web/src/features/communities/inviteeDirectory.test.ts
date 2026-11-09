import { expect, it } from 'vitest';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { findInvitee } from './inviteeDirectory';

it('finds an exact username beyond a full page of fuzzy display-name matches', async () => {
  const target = {
    id: 'target',
    username: 'invited_user',
    display_name: 'Target',
    biography: '',
  };
  const candidates = Array.from({ length: 50 }, (_, index) => ({
    ...target,
    id: `candidate-${index}`,
    username: `another_${index}`,
    display_name: 'invited_user',
  }));
  const session = {
    client: {
      GET: async (_path: string, options: { params: { query: { cursor?: string } } }) => ({
        data: options.params.query.cursor
          ? { users: [target], next_cursor: null }
          : { users: candidates, next_cursor: 'next-page' },
        response: new Response(),
      }),
    },
  } as unknown as SessionOwner;
  expect(await findInvitee(session, 'invited_user')).toEqual(target);
});
