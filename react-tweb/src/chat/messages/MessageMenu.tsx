import { Menu } from '@ark-ui/react/menu';
import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Forward,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Ripple } from '../../components/Ripple';
import { MenuDismissLayer } from '../MenuDismissLayer';
import { CURRENT_USER_ID, type Message, type MessageAction, type MessageCommand } from '../model';
import overlays from '../overlays.module.css';
import { getMessageDownloads } from './messageDownloads';
import styles from './MessageMenu.module.css';

const REACTION_BAR_OFFSET = 48;
const INCOMING_MENU_OFFSET = 16;
const OUTGOING_MENU_OFFSET = 56;

// prettier-ignore
const QUICK_REACTIONS = [
  '❤️',
  '👍',
  '👎',
  '🔥',
  '🥰',
  '👏',
  '😁',
];

// prettier-ignore
const MORE_REACTIONS = [
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '🙏',
  '👌',
  '🕊️',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '💯',
  '⚡',
  '🏆',
  '💔',
];

export interface MessageMenuTarget {
  messageId: string;
  selectedIds?: string[];
  trigger: HTMLButtonElement;
  point: { x: number; y: number };
}

interface MessageMenuProps {
  contentId: string;
  target?: MessageMenuTarget;
  message?: Message;
  selectedMessages?: Message[];
  isOpen: boolean;
  onClose: () => void;
  onExitComplete: (target?: MessageMenuTarget) => void;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
}

interface MessageMenuItem {
  action: MessageAction;
  label: string;
  icon: LucideIcon;
}

function getMessageItems(message: Message): MessageMenuItem[] {
  const items: MessageMenuItem[] = [{ action: 'reply', label: 'Reply', icon: Reply }];
  const canEdit =
    message.authorId === CURRENT_USER_ID && !message.sticker && message.media?.kind !== 'poll';
  if (canEdit) {
    items.push({ action: 'edit', label: 'Edit', icon: Pencil });
  }
  if (message.text.trim()) {
    items.push({ action: 'copy', label: 'Copy', icon: Copy });
  }
  items.push({
    action: 'pin',
    label: message.isPinned ? 'Unpin' : 'Pin',
    icon: message.isPinned ? PinOff : Pin,
  });
  items.push({ action: 'forward', label: 'Forward', icon: Forward });
  items.push({ action: 'select', label: 'Select', icon: CheckCircle2 });
  items.push({ action: 'delete', label: 'Delete', icon: Trash2 });
  return items;
}

function getSelectionItems(options: {
  message: Message;
  selectedMessages: Message[];
}): MessageMenuItem[] {
  const isSelected = options.selectedMessages.some((message) => message.id === options.message.id);
  if (!isSelected) {
    return [{ action: 'select', label: 'Select', icon: CheckCircle2 }];
  }

  const items: MessageMenuItem[] = [];
  if (options.selectedMessages.some((message) => message.text.trim())) {
    items.push({ action: 'copy-selected', label: 'Copy selected', icon: Copy });
  }
  items.push({ action: 'forward-selected', label: 'Forward selected', icon: Forward });
  if (options.selectedMessages.some((message) => getMessageDownloads(message).length > 0)) {
    items.push({ action: 'download-selected', label: 'Download selected', icon: Download });
  }
  items.push({ action: 'clear-selection', label: 'Clear selection', icon: CheckCircle2 });
  items.push({ action: 'delete-selected', label: 'Delete selected', icon: Trash2 });
  return items;
}

/** Share one Ark UI menu across the mounted messages in a history view. */
export function MessageMenu({
  contentId,
  target,
  message,
  selectedMessages,
  isOpen,
  onClose,
  onExitComplete,
  onCommand,
  onReact,
}: MessageMenuProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSelecting = selectedMessages !== undefined;
  let items: MessageMenuItem[] = [];
  if (message) {
    items = selectedMessages
      ? getSelectionItems({ message, selectedMessages })
      : getMessageItems(message);
  }
  const reactions = isExpanded ? [...QUICK_REACTIONS, ...MORE_REACTIONS] : QUICK_REACTIONS;
  const menuOffset =
    message?.authorId === CURRENT_USER_ID ? OUTGOING_MENU_OFFSET : INCOMING_MENU_OFFSET;
  const menuKey = target
    ? `${target.messageId}:${target.point.x}:${target.point.y}`
    : 'message-menu';

  function restoreTriggerFocus() {
    // Restore before dispatching a command so reply/edit can focus the composer next.
    if (target?.trigger.isConnected) {
      target.trigger.focus({ preventScroll: true });
    }
  }

  function selectAction({ value }: { value: string }) {
    if (!message) {
      return;
    }
    if (value === 'more-reactions') {
      setIsExpanded((current) => !current);
      return;
    }
    restoreTriggerFocus();
    onClose();

    const reactionPrefix = 'react-';
    if (value.startsWith(reactionPrefix)) {
      onReact(message.id, value.slice(reactionPrefix.length));
      return;
    }
    const item = items.find((entry) => entry.action === value);
    if (item) {
      onCommand({ action: item.action, message });
    }
  }

  return (
    <Menu.Root
      key={menuKey}
      ids={{ content: contentId }}
      open={isOpen && Boolean(message)}
      positioning={{
        placement: 'bottom-start',
        gutter: 0,
        slide: true,
        overflowPadding: 8,
        getAnchorRect: () => {
          if (!target) {
            return null;
          }
          // Position the combined bounds so both the separate capsule and menu avoid screen edges.
          return {
            x: target.point.x - (isSelecting ? 0 : menuOffset),
            y: target.point.y - (isSelecting ? 0 : REACTION_BAR_OFFSET),
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
      onPointerDownOutside={(event) => event.preventDefault()}
      onEscapeKeyDown={restoreTriggerFocus}
      onExitComplete={() => {
        if (!isOpen) {
          setIsExpanded(false);
          onExitComplete(target);
        }
      }}
      onSelect={selectAction}
      lazyMount
      unmountOnExit
    >
      <MenuDismissLayer isOpen={isOpen} label="Dismiss message menu" onDismiss={onClose}>
        <Menu.Positioner>
          <Menu.Content
            className={styles.menu}
            aria-label="Message actions"
            data-own={message?.authorId === CURRENT_USER_ID}
            data-selecting={isSelecting}
          >
            {!isSelecting && (
              <div className={styles.reactionBar} data-expanded={isExpanded}>
                {reactions.map((emoji) => (
                  <Menu.Item
                    key={emoji}
                    value={`react-${emoji}`}
                    valueText={`React ${emoji}`}
                    className={styles.reaction}
                    data-selected={message?.reactions.includes(emoji)}
                    aria-label={`React ${emoji}`}
                  >
                    <span>{emoji}</span>
                  </Menu.Item>
                ))}
                <Menu.Item
                  value="more-reactions"
                  className={styles.reaction}
                  closeOnSelect={false}
                  aria-label={isExpanded ? 'Fewer reactions' : 'More reactions'}
                >
                  {isExpanded ? <ChevronUp /> : <ChevronDown />}
                </Menu.Item>
              </div>
            )}
            <div className={styles.items}>
              {items.map((item) => (
                <Menu.Item
                  key={item.action}
                  value={item.action}
                  className={overlays.menuItem}
                  data-danger={item.action === 'delete' || item.action === 'delete-selected'}
                >
                  <item.icon />
                  <span>{item.label}</span>
                  <Ripple />
                </Menu.Item>
              ))}
            </div>
          </Menu.Content>
        </Menu.Positioner>
      </MenuDismissLayer>
    </Menu.Root>
  );
}
