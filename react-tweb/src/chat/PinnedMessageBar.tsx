import { Dialog } from '@ark-ui/react/dialog';
import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { List, Pin, PinOff, X } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../components/IconButton';
import { Ripple } from '../components/Ripple';
import { MenuDismissLayer } from './MenuDismissLayer';
import { PinnedMessageIndicator } from './PinnedMessageIndicator';
import { PinnedMessagePreview } from './PinnedMessagePreview';
import { describeMessage } from './messageFormatting';
import type { Message } from './model';
import styles from './PinnedMessageBar.module.css';
import overlays from './overlays.module.css';

interface PinnedMessageBarProps {
  messages: Message[];
  onJump: (messageId: string) => void;
  onOpenList: () => void;
  onUnpin: (message: Message) => void;
}

/** Show a compact pinned preview with navigation, a pin menu, and confirmed unpinning. */
export function PinnedMessageBar({ messages, onJump, onOpenList, onUnpin }: PinnedMessageBarProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [pendingUnpin, setPendingUnpin] = useState<Message>();
  const selectedMessage = messages.find((message) => message.id === selectedId) ?? messages.at(-1);
  if (!selectedMessage) {
    return null;
  }

  const selectedIndex = messages.indexOf(selectedMessage);
  const isLatestPin = selectedIndex === messages.length - 1;
  const pinLabel = isLatestPin ? 'Pinned Message' : `Pinned Message #${selectedIndex + 1}`;

  function followPinnedMessage(message: Message) {
    onJump(message.id);
    const nextIndex = selectedIndex > 0 ? selectedIndex - 1 : messages.length - 1;
    setSelectedId(messages[nextIndex].id);
  }

  function confirmUnpin() {
    if (!pendingUnpin) {
      return;
    }
    onUnpin(pendingUnpin);
    setPendingUnpin(undefined);
  }

  return (
    <>
      <div className={styles.plate}>
        <Menu.Root
          open={isMenuOpen}
          onOpenChange={(details) => setIsMenuOpen(details.open)}
          onPointerDownOutside={(event) => event.preventDefault()}
          positioning={{ placement: 'bottom-start', gutter: 4 }}
          lazyMount
          unmountOnExit
        >
          <Menu.Trigger asChild>
            <IconButton label="Pinned message options" className={styles.iconButton}>
              <Pin />
            </IconButton>
          </Menu.Trigger>
          <MenuDismissLayer
            isOpen={isMenuOpen}
            label="Dismiss pinned message menu"
            onDismiss={() => setIsMenuOpen(false)}
          >
            <Menu.Positioner>
              <Menu.Content className={overlays.menu}>
                <Menu.Item value="list" className={overlays.menuItem} onSelect={onOpenList}>
                  <List /> Pinned Messages
                  <Ripple />
                </Menu.Item>
                <Menu.Item
                  value="unpin"
                  className={overlays.menuItem}
                  onSelect={() => setPendingUnpin(selectedMessage)}
                >
                  <PinOff /> Unpin
                  <Ripple />
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </MenuDismissLayer>
        </Menu.Root>
        <button
          className={styles.preview}
          aria-label={`${pinLabel}: ${describeMessage(selectedMessage)}`}
          onClick={() => followPinnedMessage(selectedMessage)}
        >
          <PinnedMessageIndicator count={messages.length} index={selectedIndex} />
          <PinnedMessagePreview
            message={selectedMessage}
            count={messages.length}
            index={selectedIndex}
          />
          <Ripple />
        </button>
        <IconButton
          label="Unpin message"
          className={styles.iconButton}
          onClick={() => setPendingUnpin(selectedMessage)}
        >
          <X />
        </IconButton>
      </div>
      <Dialog.Root
        open={Boolean(pendingUnpin)}
        onOpenChange={(details) => {
          if (!details.open) {
            setPendingUnpin(undefined);
          }
        }}
        role="alertdialog"
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop className={overlays.backdrop} />
          <Dialog.Positioner className={overlays.dialogPositioner}>
            <Dialog.Content className={overlays.dialog}>
              <Dialog.Title>Unpin Message</Dialog.Title>
              <Dialog.Description>Would you like to unpin this message?</Dialog.Description>
              <div className={overlays.dialogActions}>
                <Dialog.CloseTrigger className={overlays.textButton}>Cancel</Dialog.CloseTrigger>
                <button className={overlays.textButton} onClick={confirmUnpin}>
                  Unpin
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}
