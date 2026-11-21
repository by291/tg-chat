import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import type { ReactElement } from 'react';
import { Ellipsis, UserMinus, UserRoundX } from 'lucide-react';
import type { components } from '@/api/schema';
import { IconButton } from '@/components/IconButton';
import overlays from '@/components/overlays/overlays.module.css';
import type { SessionOwner } from '../auth/SessionOwner';
import { RemoteAvatar } from '../media/RemoteAvatar';
import styles from './Accounts.module.css';

const INITIALS_LENGTH = 2;

export type DirectoryScope = 'contacts' | 'blocks' | 'search';
export type DirectoryPerson = components['schemas']['PublicProfile'];
export type RelationshipAction = 'add' | 'remove' | 'block' | 'unblock';

interface ContactRowProps {
  owner: SessionOwner;
  person: DirectoryPerson;
  scope: DirectoryScope;
  isPending: boolean;
  onAction: (action: RelationshipAction, person: DirectoryPerson) => void;
  onStartChat?: (person: DirectoryPerson) => void;
}

interface ContactActionsProps {
  person: DirectoryPerson;
  scope: DirectoryScope;
  onAction: ContactRowProps['onAction'];
  isPending: boolean;
  trigger: 'context' | 'button';
  children: ReactElement;
}

function ContactActions({
  person,
  scope,
  onAction,
  isPending,
  trigger,
  children,
}: ContactActionsProps) {
  const dangerItem = `${overlays.menuItem} ${overlays.danger}`;
  // Ark positions a context menu at the pointer and a button menu at its own trigger.
  const Trigger = trigger === 'context' ? Menu.ContextTrigger : Menu.Trigger;

  return (
    <Menu.Root positioning={{ placement: 'bottom-end' }} lazyMount unmountOnExit>
      <Trigger asChild>{children}</Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={overlays.menu} aria-label={`Actions for ${person.display_name}`}>
            {scope === 'contacts' && (
              <Menu.Item
                value="remove"
                disabled={isPending}
                className={dangerItem}
                onSelect={() => onAction('remove', person)}
              >
                <UserMinus aria-hidden="true" />
                Remove contact
              </Menu.Item>
            )}
            <Menu.Item
              value="block"
              disabled={isPending}
              className={dangerItem}
              onSelect={() => onAction('block', person)}
            >
              <UserRoundX aria-hidden="true" />
              Block
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

/** Show a directory identity with its authorized avatar and scoped relationship actions. */
export function ContactRow({
  owner,
  person,
  scope,
  isPending,
  onAction,
  onStartChat,
}: ContactRowProps) {
  const identity = (
    <div className={styles.contactIdentity}>
      <RemoteAvatar
        session={owner}
        owner="user"
        id={person.id}
        fileId={person.avatar_file_id}
        initials={person.display_name.slice(0, INITIALS_LENGTH).toUpperCase()}
      />
      <div>
        <strong>{person.display_name}</strong>
        <p>@{person.username}</p>
        {person.biography && <p className={styles.hint}>{person.biography}</p>}
      </div>
    </div>
  );

  if (scope === 'blocks') {
    return (
      <li className={styles.listRow}>
        {identity}
        <button
          type="button"
          className={styles.textButton}
          disabled={isPending}
          onClick={() => onAction('unblock', person)}
        >
          Unblock
        </button>
      </li>
    );
  }

  const menu = {
    isPending,
    person,
    scope,
    onAction,
  };
  return (
    <li className={styles.listRow}>
      <ContactActions {...menu} trigger="context">
        {identity}
      </ContactActions>
      <div className={styles.rowActions}>
        {onStartChat && (
          <button type="button" className={styles.textButton} onClick={() => onStartChat(person)}>
            Message
          </button>
        )}
        {scope === 'search' && (
          <button
            type="button"
            className={styles.textButton}
            disabled={isPending}
            onClick={() => onAction('add', person)}
          >
            Add contact
          </button>
        )}
        <ContactActions {...menu} trigger="button">
          <IconButton label={`Actions for ${person.display_name}`} disabled={isPending}>
            <Ellipsis />
          </IconButton>
        </ContactActions>
      </div>
    </li>
  );
}
