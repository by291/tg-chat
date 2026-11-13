import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import type { components } from '@/api/schema';

const DIRECTORY_PAGE_LIMIT = 50;

/** Find an exact username across bounded search pages. */
export async function findInvitee(
  session: SessionOwner,
  username: string,
): Promise<components['schemas']['PublicProfile'] | undefined> {
  let cursor: string | undefined;
  do {
    const reply = await session.client.GET('/api/v1/users', {
      params: {
        query: {
          search: username,
          limit: DIRECTORY_PAGE_LIMIT,
          cursor,
        },
      },
    });
    const directory = requirePayload(reply);
    const person = directory.users.find((entry) => entry.username === username);
    if (person) {
      return person;
    }
    cursor = directory.next_cursor ?? undefined;
  } while (cursor);
  return undefined;
}
