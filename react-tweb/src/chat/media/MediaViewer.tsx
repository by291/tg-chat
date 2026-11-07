import { getPhotoMessages } from './photoGallery';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { Avatar } from '../../components/Avatar';
import { useClosingDialogValue } from '../sidebar/useClosingDialogValue';
import { ViewerPhoto } from './ViewerPhoto';
import { formatMessageDate, formatMessageTime } from '../messageFormatting';
import type { Message } from '../model';
import styles from './MediaViewer.module.css';

interface MediaViewerProps {
  message?: Message;
  messages: Message[];
  onClose: () => void;
  onNavigate: (message: Message) => void;
}

/** Present shared images in a keyboard-accessible full-screen gallery. */
export function MediaViewer({ message, messages, onClose, onNavigate }: MediaViewerProps) {
  const displayedMessage = useClosingDialogValue(message);
  const mediaMessages = getPhotoMessages(messages);
  const activeIndex = mediaMessages.findIndex((entry) => {
    return entry.id === displayedMessage?.id;
  });
  const previousMessage = mediaMessages[activeIndex - 1];
  const nextMessage = mediaMessages[activeIndex + 1];

  function navigateGallery(key: string) {
    if (key === 'ArrowLeft' && previousMessage) {
      onNavigate(previousMessage);
    }

    if (key === 'ArrowRight' && nextMessage) {
      onNavigate(nextMessage);
    }
  }

  return (
    <Dialog.Root
      open={Boolean(message)}
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={styles.positioner}>
          <Dialog.Content
            className={styles.viewer}
            onKeyDown={(event) => navigateGallery(event.key)}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onClose();
              }
            }}
          >
            <header className={styles.toolbar}>
              <Avatar initials={displayedMessage?.authorName.slice(0, 1) ?? ''} size="small" />
              <div>
                <Dialog.Title>{displayedMessage?.authorName}</Dialog.Title>
                <Dialog.Description>
                  {activeIndex + 1} of {mediaMessages.length} ·{' '}
                  {displayedMessage &&
                    `${formatMessageDate(displayedMessage.createdAt)} at ${formatMessageTime(displayedMessage.createdAt)}`}
                </Dialog.Description>
              </div>
              <a
                href={displayedMessage?.attachment?.url}
                download={displayedMessage?.attachment?.name}
                aria-label="Download image"
              >
                <Download size={23} />
              </a>
              <Dialog.CloseTrigger asChild>
                <IconButton label="Close image">
                  <X />
                </IconButton>
              </Dialog.CloseTrigger>
            </header>
            {displayedMessage?.attachment && (
              <ViewerPhoto
                message={displayedMessage}
                isOpen={Boolean(message)}
                activeIndex={activeIndex}
              />
            )}
            <div className={styles.navigation}>
              <IconButton
                label="Previous image"
                className={styles.previous}
                disabled={!previousMessage}
                onClick={() => previousMessage && onNavigate(previousMessage)}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Next image"
                className={styles.next}
                disabled={!nextMessage}
                onClick={() => nextMessage && onNavigate(nextMessage)}
              >
                <ChevronRight />
              </IconButton>
            </div>
            {displayedMessage?.text && <p className={styles.caption}>{displayedMessage.text}</p>}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
