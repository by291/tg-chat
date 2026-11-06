import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Copy, Pencil, Pin, Reply, Trash2 } from 'lucide-react';
import { CURRENT_USER_ID, type Message, type MessageCommand } from '../model';
import overlays from '../overlays.module.css';

// prettier-ignore
const QUICK_REACTIONS = [
  '❤️',
  '👍',
  '🔥',
  '🥰',
  '👏',
  '😁',
];

export interface MessageMenuTarget {
  messageId: string;
  trigger: HTMLButtonElement;
  point: { x: number; y: number };
}

interface MessageMenuProps {
  contentId: string;
  target?: MessageMenuTarget;
  message?: Message;
  isOpen: boolean;
  onClose: () => void;
  onExitComplete: () => void;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
}

/** Share one Ark UI menu across the mounted messages in a history view. */
export function MessageMenu({
  contentId,
  target,
  message,
  isOpen,
  onClose,
  onExitComplete,
  onCommand,
  onReact,
}: MessageMenuProps) {
  function restoreTriggerFocus() {
    // The shared menu has no dedicated Ark trigger; restore the actual message button ourselves.
    // Restore before dispatching a command so reply/edit can deliberately focus the composer next.
    if (target?.trigger.isConnected) {
      target.trigger.focus({ preventScroll: true });
    }
  }

  function selectAction({ value }: { value: string }) {
    if (!message) {
      return;
    }
    restoreTriggerFocus();
    onClose();

    const reactionPrefix = 'react-';
    if (value.startsWith(reactionPrefix)) {
      onReact(message.id, value.slice(reactionPrefix.length));
      return;
    }
    switch (value) {
      case 'reply':
      case 'copy':
      case 'edit':
      case 'pin':
      case 'delete':
        onCommand({ action: value, message });
    }
  }

  const canEdit =
    message?.authorId === CURRENT_USER_ID && !message.sticker && message.media?.kind !== 'poll';
  const menuKey = target
    ? `${target.messageId}:${target.point.x}:${target.point.y}`
    : 'message-menu';

  return (
    <Menu.Root
      key={menuKey}
      ids={{ content: contentId }}
      open={isOpen && Boolean(message)}
      positioning={{
        placement: 'bottom-start',
        gutter: 0,
        getAnchorRect: () => {
          if (!target) {
            return null;
          }
          return {
            x: target.point.x,
            y: target.point.y,
            width: 0,
            height: 0,
          };
        },
      }}
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
      onEscapeKeyDown={restoreTriggerFocus}
      onExitComplete={() => {
        if (!isOpen) {
          onExitComplete();
        }
      }}
      onSelect={selectAction}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={overlays.menu} aria-label="Message actions">
            <div className={overlays.reactionBar}>
              {QUICK_REACTIONS.map((emoji) => (
                <Menu.Item
                  key={emoji}
                  value={`react-${emoji}`}
                  valueText={`React ${emoji}`}
                  className={overlays.reactionButton}
                  aria-label={`React ${emoji}`}
                >
                  {emoji}
                </Menu.Item>
              ))}
            </div>
            <Menu.Item value="reply" className={overlays.menuItem}>
              <Reply /> Reply
            </Menu.Item>
            <Menu.Item value="copy" className={overlays.menuItem}>
              <Copy /> Copy text
            </Menu.Item>
            {canEdit && (
              <Menu.Item value="edit" className={overlays.menuItem}>
                <Pencil /> Edit
              </Menu.Item>
            )}
            <Menu.Item value="pin" className={overlays.menuItem}>
              <Pin /> {message?.isPinned ? 'Unpin' : 'Pin'}
            </Menu.Item>
            <Menu.Separator className={overlays.menuSeparator} />
            <Menu.Item value="delete" className={`${overlays.menuItem} ${overlays.danger}`}>
              <Trash2 /> Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
