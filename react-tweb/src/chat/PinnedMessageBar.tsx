import { Menu } from '@ark-ui/react/menu';
import { List, Pin, PinOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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

function resolvePinnedPreview(messages: Message[], anchor?: Message) {
  if (!anchor) {
    return messages.at(-1);
  }
  const selected = messages.find((message) => message.id === anchor.id);
  if (selected) {
    return selected;
  }
  // Removing a browsed pin continues toward older messages instead of jumping to the newest.
  const olderMessages = messages.filter((message) => message.createdAt <= anchor.createdAt);
  return olderMessages.at(-1) ?? messages[0];
}

/** Show a compact pinned preview with navigation, a pin menu, and requests for confirmed unpinning. */
export function PinnedMessageBar({ messages, onJump, onOpenList, onUnpin }: PinnedMessageBarProps) {
  const [selectedAnchor, setSelectedAnchor] = useState<Message>();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  useEffect(() => {
    if (messages.length === 0) {
      setSelectedAnchor(undefined);
      setIsMenuOpen(false);
    }
  }, [messages.length]);
  const selectedMessage = resolvePinnedPreview(messages, selectedAnchor);
  if (!selectedMessage) {
    return null;
  }

  const selectedIndex = messages.indexOf(selectedMessage);
  const isLatestPin = selectedIndex === messages.length - 1;
  const pinLabel = isLatestPin ? 'Pinned Message' : `Pinned Message #${selectedIndex + 1}`;

  function followPinnedMessage(message: Message) {
    onJump(message.id);
    const nextIndex = selectedIndex > 0 ? selectedIndex - 1 : messages.length - 1;
    setSelectedAnchor(messages[nextIndex]);
  }

  return (
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
                onSelect={() => onUnpin(selectedMessage)}
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
        onClick={() => onUnpin(selectedMessage)}
      >
        <X />
      </IconButton>
    </div>
  );
}
