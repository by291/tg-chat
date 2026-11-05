import { getPhotoMessages } from './photoGallery';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { formatMessageDate, formatMessageTime } from '../messageFormatting';
import type { Message } from '../model';
import styles from './MediaViewer.module.css';
import overlays from '../overlays.module.css';

interface MediaViewerProps {
  message?: Message;
  messages: Message[];
  onClose: () => void;
  onNavigate: (message: Message) => void;
}

/** Present shared images in a keyboard-accessible full-screen gallery. */
export function MediaViewer({ message, messages, onClose, onNavigate }: MediaViewerProps) {
  const mediaMessages = getPhotoMessages(messages);
  const activeIndex = mediaMessages.findIndex((entry) => {
    return entry.id === message?.id && entry.attachment?.name === message?.attachment?.name;
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
        <Dialog.Backdrop className={overlays.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content
            className={styles.viewer}
            onKeyDown={(event) => navigateGallery(event.key)}
          >
            <header className={styles.toolbar}>
              <div>
                <Dialog.Title>{message?.authorName}</Dialog.Title>
                <Dialog.Description>
                  {message &&
                    `${formatMessageDate(message.createdAt)}, ${formatMessageTime(message.createdAt)}`}
                </Dialog.Description>
              </div>
              <a
                href={message?.attachment?.url}
                download={message?.attachment?.name}
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
            {message?.attachment && (
              <img
                className={styles.image}
                src={message.attachment.url}
                alt={message.attachment.name}
                width={message.attachment.width}
                height={message.attachment.height}
              />
            )}
            <div className={styles.navigation}>
              <IconButton
                label="Previous image"
                disabled={!previousMessage}
                onClick={() => previousMessage && onNavigate(previousMessage)}
              >
                <ChevronLeft />
              </IconButton>
              <span>
                {activeIndex + 1} of {mediaMessages.length}
              </span>
              <IconButton
                label="Next image"
                disabled={!nextMessage}
                onClick={() => nextMessage && onNavigate(nextMessage)}
              >
                <ChevronRight />
              </IconButton>
            </div>
            {message?.text && <p className={styles.caption}>{message.text}</p>}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
