import { useSyncExternalStore, type ReactNode } from 'react';
import type { SessionOwner, SessionSnapshot } from '@/features/auth/SessionOwner';
import { ContactLinkContext } from '../messages/content/contact/ContactActions';

const subscribeToNothing = () => () => {};
const noAccount = () => undefined;

function canAddAccount(account: SessionSnapshot | undefined, id: string) {
  if (!account?.auth || id === account.auth.user.id) {
    return false;
  }
  const relationships = account.relationships;
  return !relationships?.contacts.has(id) && !relationships?.blocks.has(id);
}

/** Connect shared-card actions to admitted relationships in the live session. */
export function ConnectedContactLinks({
  session,
  onOpen,
  children,
}: {
  session?: SessionOwner;
  onOpen: (id: string) => void;
  children: ReactNode;
}) {
  const account = useSyncExternalStore(
    session?.subscribe ?? subscribeToNothing,
    session?.getSnapshot ?? noAccount,
  );
  const sessionId = account?.auth?.session.id;
  const links =
    session && sessionId
      ? {
          sessionId,
          open: onOpen,
          canAdd: (id: string) => canAddAccount(account, id),
          add: async (id: string) => {
            const current = session.getSnapshot();
            if (current.auth?.session.id !== sessionId || !canAddAccount(current, id)) {
              throw new Error('This account cannot be added.');
            }
            await session.setRelationship({
              kind: 'contacts',
              id,
              shouldInclude: true,
            });
          },
        }
      : undefined;
  return <ContactLinkContext value={links}>{children}</ContactLinkContext>;
}
