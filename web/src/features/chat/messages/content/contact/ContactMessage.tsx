import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import {
  Building2,
  CalendarDays,
  Link,
  Mail,
  MapPin,
  Phone,
  StickyNote,
  UserRound,
} from 'lucide-react';
import { useContext, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { copyTextWithToast } from '@/components/copyTextWithToast';
import { Ripple } from '@/components/Ripple';
import type { ContactDetail, ContactMedia } from '@/domain/messages/media';
import { CURRENT_USER_ID } from '@/domain/identity';
import overlays from '@/components/overlays/overlays.module.css';
import { AddContactDialog } from './AddContactDialog';
import { ContactLinkContext, getContactColor, useContactActions } from './ContactActions';
import styles from './ContactMessage.module.css';

const MAX_PREVIEW_LINES = 5;
const DETAIL_ICON_SIZE = 24;
const DETAIL_LABELS = {
  phone: 'Phone',
  email: 'Email',
  organization: 'Organization',
  address: 'Address',
  website: 'Website',
  note: 'Note',
  birthday: 'Birthday',
  name: 'Name',
};
const DETAIL_ICONS = {
  phone: Phone,
  email: Mail,
  organization: Building2,
  address: MapPin,
  website: Link,
  note: StickyNote,
  birthday: CalendarDays,
  name: UserRound,
};

interface ContactDetailsDialogProps {
  details: ContactDetail[];
  isOpen: boolean;
  onOpenChange: (options: { isOpen: boolean }) => void;
}

function copyDetail(detail: ContactDetail) {
  const isPhone = detail.type === 'phone';
  return copyTextWithToast({
    text: detail.value,
    successMessage: isPhone ? 'Phone number copied' : 'Text copied',
    errorMessage: isPhone ? 'Could not copy phone number' : 'Could not copy text',
  });
}

function getContactPreview(media: ContactMedia) {
  const details = media.details?.filter((detail) => detail.value.trim()) ?? [];
  const organization = details.find((detail) => detail.type === 'organization')?.value;
  const displayName = media.name.trim() || organization || 'Contact';
  const phoneDetails = details.filter((detail) => detail.type === 'phone');
  const phones = phoneDetails.map((detail) => detail.value);
  if (phones.length === 0 && media.phone.trim()) {
    phones.push(media.phone);
  }

  const emailDetails = details.filter((detail) => detail.type === 'email');
  const emails = emailDetails.map((detail) => detail.value);
  const lines = [...phones, ...emails];
  if (organization && organization !== displayName) {
    lines.push(organization);
  }

  return {
    details,
    displayName,
    lines: lines.slice(0, MAX_PREVIEW_LINES),
  };
}

function ContactDetailsDialog({ details, isOpen, onOpenChange }: ContactDetailsDialogProps) {
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(event) => onOpenChange({ isOpen: event.open })}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${styles.detailsDialog}`}>
            <Dialog.Title>Contact Details</Dialog.Title>
            <Dialog.Description className={styles.description}>
              Select a field to copy it.
            </Dialog.Description>
            <div className={styles.detailList}>
              {details.map((detail, index) => {
                const Icon = DETAIL_ICONS[detail.type];

                return (
                  <button
                    key={`${detail.type}-${index}`}
                    type="button"
                    className={styles.detailRow}
                    onClick={() => void copyDetail(detail)}
                  >
                    <Icon size={DETAIL_ICON_SIZE} aria-hidden="true" />
                    <span>
                      <span>{detail.value}</span>
                      <small>{detail.label || DETAIL_LABELS[detail.type]}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className={overlays.dialogActions}>
              <Dialog.CloseTrigger className={overlays.textButton}>Close</Dialog.CloseTrigger>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** Show a shared contact and open its details, or copy its phone when no details exist. */
export function ContactMessage({ media }: { media: ContactMedia }) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const actions = useContactActions();
  const conversation = media.userId ? actions?.getConversation(media.userId) : undefined;
  const openAccountLink = useContext(ContactLinkContext);
  const canMessage = Boolean(media.userId && (actions || openAccountLink));
  const isSavedContact = Boolean(conversation && conversation.isContact !== false);
  const canAdd = Boolean(
    actions && canMessage && media.userId !== CURRENT_USER_ID && !isSavedContact,
  );
  const avatarColor = conversation?.color || getContactColor(media.userId || media.name);
  const { details, displayName, lines } = getContactPreview({
    ...media,
    phone: conversation?.phone || media.phone,
  });
  const hasDetails = details.length > 0;
  const canCopyPhone = Boolean(media.phone.trim());
  const canActivate = hasDetails || canCopyPhone || canMessage;
  const MainElement = canActivate ? 'button' : 'div';
  let actionLabel = `Copy phone number for ${displayName}`;
  if (canMessage) {
    actionLabel = `Open chat with ${displayName}`;
  }
  if (hasDetails) {
    actionLabel = `Contact details for ${displayName}`;
  }

  function openLinkedConversation() {
    if (media.userId && openAccountLink) {
      openAccountLink(media.userId);
      return;
    }
    actions?.openConversation(media);
  }

  function activateContact() {
    // Details take precedence over copying, matching the shared vCard's primary action.
    if (hasDetails) {
      setIsDetailsOpen(true);
      return;
    }
    if (canMessage) {
      openLinkedConversation();
      return;
    }
    if (canCopyPhone) {
      void copyDetail({ type: 'phone', value: media.phone });
    }
  }

  return (
    <>
      <div className={styles.card}>
        <MainElement
          className={styles.main}
          type={canActivate ? 'button' : undefined}
          aria-label={canActivate ? actionLabel : undefined}
          onClick={canActivate ? activateContact : undefined}
        >
          <span className={styles.avatar}>
            <Avatar
              initials={media.initials || displayName.slice(0, 1).toUpperCase()}
              color={avatarColor}
            />
          </span>
          <span className={styles.preview}>
            <strong>{displayName}</strong>
            {lines.map((line, index) => (
              <span key={index}>{line}</span>
            ))}
          </span>
          {canActivate && <Ripple />}
        </MainElement>
        {canMessage && (
          <div className={`${styles.footer} ${styles.splitFooter}`}>
            <button type="button" className={styles.footerButton} onClick={openLinkedConversation}>
              Message
              <Ripple />
            </button>
            {canAdd && (
              <button
                type="button"
                className={styles.footerButton}
                onClick={() => setIsAddOpen(true)}
              >
                Add
                <Ripple />
              </button>
            )}
          </div>
        )}
        {hasDetails && !canMessage && (
          <button type="button" className={styles.footer} onClick={activateContact}>
            View Contact
            <Ripple />
          </button>
        )}
      </div>
      <ContactDetailsDialog
        details={details}
        isOpen={isDetailsOpen}
        onOpenChange={({ isOpen }) => setIsDetailsOpen(isOpen)}
      />
      <AddContactDialog media={media} isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
    </>
  );
}
