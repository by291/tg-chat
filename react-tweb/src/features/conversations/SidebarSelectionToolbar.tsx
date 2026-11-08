import { Menu } from '@ark-ui/react/menu';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Mail,
  MailOpen,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/components/overlays/MenuDismissLayer';
import type { ConversationPreferences } from '@/domain/conversations/conversation';
import type { ConversationListEntry } from './conversationList';
import overlays from '@/components/overlays/overlays.module.css';
import styles from './ChatSidebar.module.css';

interface SidebarSelectionToolbarProps {
  conversations: ConversationListEntry[];
  onClear: () => void;
  onUpdate: (changes: ConversationPreferences) => void;
  onDelete: () => void;
}

interface SelectionAction {
  label: string;
  icon: LucideIcon;
  changes?: ConversationPreferences;
}

function getSelectionActions(conversations: ConversationListEntry[]): SelectionAction[] {
  const hasUnread = conversations.some((conversation) => conversation.hasUnread);
  const isEveryConversationPinned = conversations.every((conversation) => conversation.isPinned);
  const isEveryConversationMuted = conversations.every((conversation) => conversation.isMuted);
  const isEveryConversationArchived = conversations.every(
    (conversation) => conversation.isArchived,
  );
  const canMuteOrArchive = conversations.every((conversation) => conversation.kind !== 'saved');
  const actions: SelectionAction[] = [
    {
      label: hasUnread ? 'Mark as read' : 'Mark as unread',
      icon: hasUnread ? MailOpen : Mail,
      changes: { unreadCount: 0, isMarkedUnread: !hasUnread },
    },
    {
      label: isEveryConversationPinned ? 'Unpin' : 'Pin',
      icon: isEveryConversationPinned ? PinOff : Pin,
      changes: { isPinned: !isEveryConversationPinned },
    },
  ];

  if (canMuteOrArchive) {
    actions.push({
      label: isEveryConversationMuted ? 'Unmute' : 'Mute',
      icon: isEveryConversationMuted ? Bell : BellOff,
      changes: { isMuted: !isEveryConversationMuted, mutedUntil: 0 },
    });
    actions.push({
      label: isEveryConversationArchived ? 'Unarchive' : 'Archive',
      icon: isEveryConversationArchived ? ArchiveRestore : Archive,
      changes: { isArchived: !isEveryConversationArchived },
    });
  }
  actions.push({ label: 'Delete', icon: Trash2 });
  return actions;
}

/** Replace the sidebar header with a selected-chat count and Telegram's compact actions menu. */
export function SidebarSelectionToolbar({
  conversations,
  onClear,
  onUpdate,
  onDelete,
}: SidebarSelectionToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const actions = getSelectionActions(conversations);
  const countLabel =
    conversations.length === 1 ? '1 chat selected' : `${conversations.length} chats selected`;

  return (
    <div className={styles.selectionToolbar} role="toolbar" aria-label="Selected conversations">
      <IconButton label="Cancel selection" onClick={onClear}>
        <X />
      </IconButton>
      <strong className={styles.selectionCount}>{countLabel}</strong>
      <Menu.Root
        open={isOpen}
        onOpenChange={(details) => setIsOpen(details.open)}
        onPointerDownOutside={(event) => event.preventDefault()}
        positioning={{ placement: 'bottom-end', gutter: 4 }}
        lazyMount
        unmountOnExit
      >
        <Menu.Trigger asChild>
          <IconButton label="Selected conversation actions">
            <MoreVertical />
          </IconButton>
        </Menu.Trigger>
        <MenuDismissLayer
          isOpen={isOpen}
          label="Dismiss selection menu"
          onDismiss={() => setIsOpen(false)}
        >
          <Menu.Positioner>
            <Menu.Content className={`${overlays.menu} ${styles.contextMenu}`}>
              {actions.map((action) => (
                <Menu.Item
                  key={action.label}
                  value={action.label}
                  className={overlays.menuItem}
                  data-danger={!action.changes}
                  onSelect={() => {
                    if (action.changes) {
                      onUpdate(action.changes);
                      return;
                    }
                    onDelete();
                  }}
                >
                  <action.icon />
                  {action.label}
                  <Ripple />
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </MenuDismissLayer>
      </Menu.Root>
    </div>
  );
}
