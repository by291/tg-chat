import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useState } from 'react';
import type { Conversation } from '../model';
import overlays from '../overlays.module.css';
import dialogs from '../sidebar/ConversationDialogs.module.css';
import styles from './ChatDetails.module.css';

interface ChatProfileDialogProps {
  mode?: 'edit' | 'members';
  conversation: Conversation;
  contacts: Conversation[];
  onClose: () => void;
  onSave: (conversation: Conversation) => void;
}

function ProfileFields({ mode, conversation, contacts, onSave }: ChatProfileDialogProps) {
  const [title, setTitle] = useState(conversation.title);
  const [about, setAbout] = useState(conversation.about ?? '');
  const [memberIds, setMemberIds] = useState(conversation.memberIds ?? ['you']);

  function saveProfile() {
    if (!title.trim()) {
      return;
    }
    let subtitle = conversation.subtitle;
    if (conversation.kind === 'group' && mode === 'members') {
      subtitle = memberIds.length === 1 ? '1 member' : `${memberIds.length} members`;
    }
    onSave({
      ...conversation,
      title: title.trim(),
      about: about.trim(),
      memberIds,
      subtitle,
    });
  }

  return (
    <form
      className={styles.profileForm}
      onSubmit={(event) => {
        event.preventDefault();
        saveProfile();
      }}
    >
      {mode === 'edit' && (
        <>
          <label>
            Name
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            About
            <textarea value={about} onChange={(event) => setAbout(event.target.value)} />
          </label>
        </>
      )}
      {mode === 'members' &&
        contacts.map((contact) => (
          <label key={contact.id} className={styles.contactChoice}>
            <input
              type="checkbox"
              checked={memberIds.includes(contact.id)}
              onChange={(event) => {
                const shouldInclude = event.target.checked;
                setMemberIds((current) =>
                  shouldInclude
                    ? [...current, contact.id]
                    : current.filter((id) => id !== contact.id),
                );
              }}
            />
            {contact.title}
          </label>
        ))}
      <div className={overlays.dialogActions}>
        <Dialog.CloseTrigger type="button" className={overlays.textButton}>
          Cancel
        </Dialog.CloseTrigger>
        <button className={overlays.textButton} disabled={!title.trim()} type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

/** Edit local profile information or membership without changing a Telegram account. */
export function ChatProfileDialog(props: ChatProfileDialogProps) {
  return (
    <Dialog.Root
      open={Boolean(props.mode)}
      onOpenChange={({ open }) => {
        if (!open) {
          props.onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={overlays.dialog}>
            <Dialog.Title>{props.mode === 'members' ? 'Add Members' : 'Edit Info'}</Dialog.Title>
            <Dialog.Description>Changes are saved on this device.</Dialog.Description>
            <ProfileFields {...props} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
