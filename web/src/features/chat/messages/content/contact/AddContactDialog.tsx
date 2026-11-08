import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useState } from 'react';
import type { ContactMedia } from '@/domain/messages/media';
import overlays from '@/components/overlays/overlays.module.css';
import { useContactActions } from './ContactActions';
import styles from './ContactMessage.module.css';

interface AddContactDialogProps {
  media: ContactMedia;
  isOpen: boolean;
  onClose: () => void;
}

function AddContactForm({ media, onClose }: Pick<AddContactDialogProps, 'media' | 'onClose'>) {
  const nameParts = media.name.trim().split(/\s+/);
  const [firstName, setFirstName] = useState(nameParts[0]);
  const [lastName, setLastName] = useState(nameParts.slice(1).join(' '));
  const [phone, setPhone] = useState(media.phone);
  const actions = useContactActions();
  const canSave = Boolean(firstName.trim() && phone.trim() && actions);

  return (
    <form
      className={styles.contactForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) {
          return;
        }
        actions?.saveContact({
          media,
          firstName,
          lastName,
          phone,
        });
        onClose();
      }}
    >
      <label>
        First name
        <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
      </label>
      <label>
        Last name
        <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
      </label>
      <label>
        Phone number
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
      </label>
      <div className={overlays.dialogActions}>
        <Dialog.CloseTrigger type="button" className={overlays.textButton}>
          Cancel
        </Dialog.CloseTrigger>
        <button type="submit" className={overlays.textButton} disabled={!canSave}>
          Save
        </button>
      </div>
    </form>
  );
}

/** Edit a shared peer's contact details before saving them on this device. */
export function AddContactDialog({ media, isOpen, onClose }: AddContactDialogProps) {
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${styles.detailsDialog}`}>
            <Dialog.Title>Add Contact</Dialog.Title>
            <Dialog.Description>Contact details are saved on this device.</Dialog.Description>
            <AddContactForm media={media} onClose={onClose} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
