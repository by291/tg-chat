import { Menu } from '@ark-ui/react/menu';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  CheckSquare,
  ExternalLink,
  Eye,
  Mail,
  MailOpen,
  MessageSquareX,
  Pin,
  PinOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/features/chat/MenuDismissLayer';
import {
  getDeleteConversationLabel,
  type ConversationListEntry,
  type ConversationMenuAction,
} from './conversationList';
import overlays from '@/features/chat/overlays.module.css';
import styles from './ChatSidebar.module.css';
import { readPreviewAnchor, type PreviewAnchor } from './previewPosition';

interface ConversationMenuProps {
  conversation: ConversationListEntry;
  isSelecting: boolean;
  onAction: (action: ConversationMenuAction, anchor?: PreviewAnchor) => void;
  children: ReactElement;
}

interface ConversationMenuItem {
  action: ConversationMenuAction;
  label: string;
  icon: LucideIcon;
}

function getMenuItems(conversation: ConversationListEntry): ConversationMenuItem[] {
  const items: ConversationMenuItem[] = [
    {
      action: 'open-tab',
      label: 'Open in new tab',
      icon: ExternalLink,
    },
    {
      action: 'preview',
      label: 'Preview',
      icon: Eye,
    },
    {
      action: 'select',
      label: 'Select',
      icon: CheckSquare,
    },
    {
      action: 'read',
      label: conversation.hasUnread ? 'Mark as read' : 'Mark as unread',
      icon: conversation.hasUnread ? MailOpen : Mail,
    },
    {
      action: 'pin',
      label: conversation.isPinned ? 'Unpin' : 'Pin',
      icon: conversation.isPinned ? PinOff : Pin,
    },
  ];

  if (conversation.kind !== 'saved') {
    items.push({
      action: 'mute',
      label: conversation.isMuted ? 'Unmute' : 'Mute',
      icon: conversation.isMuted ? Bell : BellOff,
    });
    items.push({
      action: 'archive',
      label: conversation.isArchived ? 'Unarchive' : 'Archive',
      icon: conversation.isArchived ? ArchiveRestore : Archive,
    });
  }

  items.push({
    action: 'clear',
    label: 'Clear history',
    icon: MessageSquareX,
  });
  items.push({
    action: 'delete',
    label: getDeleteConversationLabel(conversation),
    icon: Trash2,
  });
  return items;
}

/** Open the conversation actions at the pointer without selecting or reading that chat. */
export function ConversationMenu({
  conversation,
  isSelecting,
  onAction,
  children,
}: ConversationMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = getMenuItems(conversation);

  return (
    <Menu.Root
      open={isOpen && !isSelecting}
      onOpenChange={(details) => setIsOpen(details.open)}
      onPointerDownOutside={(event) => event.preventDefault()}
      positioning={{ placement: 'bottom-start', gutter: 0 }}
      lazyMount
      unmountOnExit
    >
      <Menu.ContextTrigger ref={triggerRef} asChild>
        {children}
      </Menu.ContextTrigger>
      <MenuDismissLayer
        isOpen={isOpen && !isSelecting}
        label="Dismiss conversation menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={`${overlays.menu} ${styles.contextMenu}`}>
            {items.map((item) => (
              <Menu.Item
                key={item.action}
                value={item.action}
                className={overlays.menuItem}
                data-danger={item.action === 'delete'}
                onSelect={() => {
                  const anchor = triggerRef.current
                    ? readPreviewAnchor(triggerRef.current)
                    : undefined;
                  onAction(item.action, anchor);
                }}
              >
                <item.icon />
                {item.label}
                <Ripple />
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </MenuDismissLayer>
    </Menu.Root>
  );
}
