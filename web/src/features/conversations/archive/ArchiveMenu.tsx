import { Menu } from '@ark-ui/react/menu';
import {
  Archive,
  EyeOff,
  HelpCircle,
  MailCheck,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/components/overlays/MenuDismissLayer';
import overlays from '@/components/overlays/overlays.module.css';
import styles from '../ChatSidebar.module.css';

export type ArchiveMenuAction = 'search' | 'visibility' | 'read' | 'settings' | 'help';

interface ArchiveMenuProps {
  trigger: 'context' | 'button';
  isShownInChatList: boolean;
  hasUnread: boolean;
  onAction: (action: ArchiveMenuAction) => void;
  children: ReactElement;
}

interface ArchiveMenuItem {
  action: ArchiveMenuAction;
  label: string;
  icon: LucideIcon;
}

function getArchiveMenuItems({
  isShownInChatList,
  hasUnread,
}: Pick<ArchiveMenuProps, 'isShownInChatList' | 'hasUnread'>): ArchiveMenuItem[] {
  const items: ArchiveMenuItem[] = [
    {
      action: 'search',
      label: 'Search',
      icon: Search,
    },
    {
      action: 'visibility',
      label: isShownInChatList ? 'Hide from Chat List' : 'Show in Chat List',
      icon: isShownInChatList ? EyeOff : Archive,
    },
  ];
  if (hasUnread) {
    items.push({
      action: 'read',
      label: 'Mark All as Read',
      icon: MailCheck,
    });
  }
  items.push(
    {
      action: 'settings',
      label: 'Archive Settings',
      icon: Settings,
    },
    {
      action: 'help',
      label: 'How does it work?',
      icon: HelpCircle,
    },
  );
  return items;
}

/** Share the archive's actions between its context menu and page header menu. */
export function ArchiveMenu({
  trigger,
  isShownInChatList,
  hasUnread,
  onAction,
  children,
}: ArchiveMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const items = getArchiveMenuItems({ isShownInChatList, hasUnread });
  const isContextMenu = trigger === 'context';

  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={(details) => setIsOpen(details.open)}
      onPointerDownOutside={(event) => event.preventDefault()}
      positioning={{ placement: isContextMenu ? 'bottom-start' : 'bottom-end', gutter: 0 }}
      lazyMount
      unmountOnExit
    >
      {isContextMenu ? (
        <Menu.ContextTrigger asChild>{children}</Menu.ContextTrigger>
      ) : (
        <Menu.Trigger asChild>{children}</Menu.Trigger>
      )}
      <MenuDismissLayer
        isOpen={isOpen}
        label="Dismiss archive menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={`${overlays.menu} ${styles.contextMenu}`}>
            {items.map((item) => (
              <Menu.Item
                key={item.action}
                value={item.action}
                className={overlays.menuItem}
                onSelect={() => onAction(item.action)}
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
