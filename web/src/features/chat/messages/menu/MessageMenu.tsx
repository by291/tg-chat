import { Menu } from '@ark-ui/react/menu';
import { useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Flag,
  Forward,
  Pencil,
  Plus,
  RotateCcw,
  Pin,
  PinOff,
  Reply,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { ReactionPicker } from '../reactions/ReactionPicker';
import { QUICK_REACTIONS } from '../reactions/reactionChoices';
import { holdReactionFlight } from '../reactions/reactionFlight';
import { prepareReactionLayout } from '../reactions/reactionLayoutTransition';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/components/overlays/MenuDismissLayer';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
import { type Message } from '@/domain/messages/message';
import { type MessageCommand, type MessageMenuAction } from '@/features/chat/messages/commands';
import overlays from '@/components/overlays/overlays.module.css';
import { getMessageDownloads } from '../messageDownloads';
import styles from './MessageMenu.module.css';
import { MAX_CHECKLIST_TASKS } from '@/domain/messages/media';
import { getSelectedPollOptions } from '../../state/pollVoting';
import { useStructuredMessageActions } from '../StructuredMessageActions';
import { MessageReadTimeLine } from './MessageReadTimeScope';

const REACTION_BAR_OFFSET = 48;
const REACTION_MENU_OFFSET = 56;
const POSITION_TOLERANCE = 1;

export interface MessageMenuTarget {
  messageId: string;
  selectedIds?: string[];
  row: HTMLElement;
  point: { x: number; y: number };
}

interface MessageMenuProps {
  allowedActions?: MessageMenuAction[];
  reactionChoices?: string[];
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
  action: MessageMenuAction;
  label: string;
  icon: LucideIcon;
}

function getMessageItems(message: Message, currentUserId: string): MessageMenuItem[] {
  const items: MessageMenuItem[] = [
    {
      action: 'reply',
      label: 'Reply',
      icon: Reply,
    },
  ];
  const canEdit =
    message.authorId === currentUserId &&
    !message.sticker &&
    message.media?.kind !== 'poll' &&
    message.media?.kind !== 'checklist';
  const media = message.media;
  const canAppendTask =
    media?.kind === 'checklist' &&
    !message.forwardedFrom &&
    (media.canAppend ?? (message.authorId === currentUserId || media.canOthersAppend)) &&
    media.items.length < MAX_CHECKLIST_TASKS;
  if (canAppendTask) {
    items.push({
      action: 'add-task',
      label: 'Add Task',
      icon: Plus,
    });
  }
  if (media?.kind === 'checklist' && media.canEdit && !message.forwardedFrom) {
    items.push({
      action: 'edit-checklist',
      label: 'Edit Checklist',
      icon: Pencil,
    });
  }
  const canChangeVote =
    media?.kind === 'poll' &&
    media.canRevote !== false &&
    (!media.closesAt || media.closesAt > Date.now()) &&
    getSelectedPollOptions(media).length > 0;
  if (canChangeVote) {
    items.push({
      action: 'change-vote',
      label: 'Change vote',
      icon: RotateCcw,
    });
  }
  if (canEdit) {
    items.push({
      action: 'edit',
      label: 'Edit',
      icon: Pencil,
    });
  }
  if (message.text.trim()) {
    items.push({
      action: 'copy',
      label: 'Copy',
      icon: Copy,
    });
  }
  items.push({
    action: 'pin',
    label: message.isPinned ? 'Unpin' : 'Pin',
    icon: message.isPinned ? PinOff : Pin,
  });
  items.push({
    action: 'forward',
    label: 'Forward',
    icon: Forward,
  });
  items.push({
    action: 'select',
    label: 'Select',
    icon: CheckCircle2,
  });
  items.push({
    action: 'delete',
    label: 'Delete',
    icon: Trash2,
  });

  return items;
}

function getSelectionItems(options: {
  message: Message;
  selectedMessages: Message[];
}): MessageMenuItem[] {
  const isSelected = options.selectedMessages.some((message) => message.id === options.message.id);
  if (!isSelected) {
    return [
      {
        action: 'select',
        label: 'Select',
        icon: CheckCircle2,
      },
    ];
  }

  const items: MessageMenuItem[] = [];
  if (options.selectedMessages.some((message) => message.text.trim())) {
    items.push({
      action: 'copy-selected',
      label: 'Copy selected',
      icon: Copy,
    });
  }
  items.push({
    action: 'forward-selected',
    label: 'Forward selected',
    icon: Forward,
  });
  if (options.selectedMessages.some((message) => getMessageDownloads(message).length > 0)) {
    items.push({
      action: 'download-selected',
      label: 'Download selected',
      icon: Download,
    });
  }
  items.push({
    action: 'clear-selection',
    label: 'Clear selection',
    icon: CheckCircle2,
  });
  items.push({
    action: 'delete-selected',
    label: 'Delete selected',
    icon: Trash2,
  });

  return items;
}

/** Share one Ark UI menu across the mounted messages in a history view. */
export function MessageMenu({
  contentId,
  allowedActions,
  reactionChoices,
  target,
  message,
  selectedMessages,
  isOpen,
  onClose,
  onExitComplete,
  onCommand,
  onReact,
}: MessageMenuProps) {
  const currentUserId = useCurrentUserId();
  const [pickerBounds, setPickerBounds] = useState<DOMRect>();
  const reactionBarRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isExpanded = Boolean(pickerBounds);
  const structuredActions = useStructuredMessageActions();
  const isSelecting = selectedMessages !== undefined;
  const canShowReadTime =
    isOpen &&
    !isSelecting &&
    !isExpanded &&
    message?.authorId === currentUserId &&
    message.isRead &&
    !message.isService;
  let items: MessageMenuItem[] = [];
  if (message) {
    items = selectedMessages
      ? getSelectionItems({ message, selectedMessages })
      : getMessageItems(message, currentUserId);
  }
  if (allowedActions) {
    if (!isSelecting && allowedActions.includes('report')) {
      items.push({
        action: 'report',
        label: 'Report',
        icon: Flag,
      });
    }
    items = items.filter((item) => allowedActions.includes(item.action));
  }
  const selectedReactions = message?.reactionDetails
    ? message.reactionDetails
        .filter((reaction) => reaction.isSelected)
        .map((reaction) => reaction.emoji)
    : (message?.reactions ?? []);
  const menuKey = target
    ? `${target.messageId}:${target.point.x}:${target.point.y}`
    : 'message-menu';

  function restoreRowFocus() {
    // Restore before dispatching a command so reply/edit can focus the composer next.
    if (target?.row.isConnected) {
      target.row.focus({ preventScroll: true });
    }
  }

  function selectReaction(options: { emoji: string; source?: HTMLElement | null }) {
    if (!message || !target) {
      return;
    }
    if (options.source && !message.reactions.includes(options.emoji)) {
      holdReactionFlight({
        source: options.source,
        targetRow: target.row.querySelector('article') ?? target.row,
        emoji: options.emoji,
        messageId: message.id,
      });
    }
    restoreRowFocus();
    onClose();
    prepareReactionLayout({ row: target.row });
    onReact(message.id, options.emoji);
  }

  function selectAction({ value }: { value: string }) {
    if (!message) {
      return;
    }
    if (value === 'more-reactions') {
      setPickerBounds(reactionBarRef.current?.getBoundingClientRect());
      return;
    }

    const reactionPrefix = 'react-';
    if (value.startsWith(reactionPrefix)) {
      const emoji = value.slice(reactionPrefix.length);
      const source = reactionBarRef.current?.querySelector<HTMLElement>(
        `[data-reaction-emoji="${emoji}"]`,
      );
      selectReaction({ emoji, source });
      return;
    }

    restoreRowFocus();
    onClose();
    const item = items.find((entry) => entry.action === value);
    if (
      item?.action === 'add-task' ||
      item?.action === 'change-vote' ||
      item?.action === 'edit-checklist'
    ) {
      structuredActions.dispatch({ messageId: message.id, action: item.action });
      return;
    }
    if (item) {
      onCommand({ action: item.action, message });
    }
  }

  return (
    <>
      <Menu.Root
        key={menuKey}
        ids={{ content: contentId }}
        open={isOpen && !isExpanded && Boolean(message)}
        positioning={{
          placement: 'bottom-start',
          gutter: 0,
          flip: false,
          slide: true,
          overlap: true,
          overflowPadding: 8,
          updatePosition: async ({ updatePosition }) => {
            // Ark only reports completed placement through this positioning override.
            await updatePosition();
            const menu = menuRef.current;
            const itemsElement = itemsRef.current;
            if (!menu || !itemsElement || !target) {
              return;
            }

            const bounds = menu.getBoundingClientRect();
            const top = bounds.top + itemsElement.offsetTop;
            const left = bounds.left + itemsElement.offsetLeft;
            // TG shifts edge menus into view and changes their pivot instead of flipping them.
            menu.dataset.verticalClamped = String(top < target.point.y - POSITION_TOLERANCE);
            menu.dataset.horizontalClamped = String(left < target.point.x - POSITION_TOLERANCE);
          },
          getAnchorRect: () => {
            if (!target) {
              return null;
            }
            // Keep the reaction capsule and action menu inside the viewport together.
            return {
              x: target.point.x - (isSelecting ? 0 : REACTION_MENU_OFFSET),
              y: target.point.y - (isSelecting ? 0 : REACTION_BAR_OFFSET),
              width: 0,
              height: 0,
            };
          },
        }}
        onOpenChange={(details) => {
          if (!details.open && !isExpanded) {
            onClose();
          }
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={restoreRowFocus}
        onExitComplete={() => {
          if (!isOpen && !isExpanded) {
            onExitComplete(target);
          }
        }}
        onSelect={selectAction}
        lazyMount
        unmountOnExit
      >
        <MenuDismissLayer
          isOpen={isOpen && !isExpanded}
          label="Dismiss message menu"
          onDismiss={onClose}
        >
          <Menu.Positioner>
            <Menu.Content
              ref={menuRef}
              className={styles.menu}
              aria-label="Message actions"
              data-own={message?.authorId === currentUserId}
              data-selecting={isSelecting}
            >
              {!isSelecting && (
                <div ref={reactionBarRef} className={styles.reactionBar}>
                  {(reactionChoices ?? QUICK_REACTIONS).map((emoji) => (
                    <Menu.Item
                      key={emoji}
                      value={`react-${emoji}`}
                      valueText={`React ${emoji}`}
                      className={styles.reaction}
                      data-selected={selectedReactions.includes(emoji)}
                      aria-label={`React ${emoji}`}
                    >
                      <span data-reaction-emoji={emoji}>{emoji}</span>
                    </Menu.Item>
                  ))}
                  {!reactionChoices && (
                    <Menu.Item
                      value="more-reactions"
                      className={styles.reaction}
                      closeOnSelect={false}
                      aria-label="More reactions"
                    >
                      <ChevronDown />
                    </Menu.Item>
                  )}
                </div>
              )}
              <div ref={itemsRef} className={styles.items}>
                {canShowReadTime && <MessageReadTimeLine key={message.id} messageId={message.id} />}
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
      {pickerBounds && (
        <ReactionPicker
          anchor={pickerBounds}
          replacedMenuId={contentId}
          isOpen={isOpen}
          selected={selectedReactions}
          onSelect={selectReaction}
          onClose={() => {
            restoreRowFocus();
            onClose();
          }}
          onExitComplete={() => {
            setPickerBounds(undefined);
            onExitComplete(target);
          }}
        />
      )}
    </>
  );
}
