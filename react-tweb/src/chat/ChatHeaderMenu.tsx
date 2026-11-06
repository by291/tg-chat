import { Menu } from '@ark-ui/react/menu';
import {
  Bell,
  BellOff,
  CheckSquare,
  ChevronLeft,
  MessageSquareX,
  MoreVertical,
  Search,
  Timer,
  Trash2,
  Video,
} from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../components/IconButton';
import { Ripple } from '../components/Ripple';
import { MenuDismissLayer } from './MenuDismissLayer';
import { getDeleteConversationLabel } from './sidebar/conversationList';
import type { Conversation } from './model';
import styles from './ChatHeader.module.css';
import overlays from './overlays.module.css';

const AUTO_DELETE_OPTIONS = [
  { days: 0, label: 'Never' },
  { days: 1, label: '1 day' },
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
];

export type HeaderAction = 'mute' | 'call' | 'select' | 'clear' | 'delete' | 'auto-delete';

interface ChatHeaderMenuProps {
  conversation: Conversation;
  isSelecting: boolean;
  onSearch: () => void;
  onAction: (action: HeaderAction) => void;
  onAutoDelete: (days: number) => void;
}

/** Show the conversation-specific actions available in Telegram's topbar menu. */
export function ChatHeaderMenu({
  conversation,
  isSelecting,
  onSearch,
  onAction,
  onAutoDelete,
}: ChatHeaderMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isSaved = conversation.kind === 'saved';
  const isGroup = conversation.kind === 'group';

  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={(details) => setIsOpen(details.open)}
      onPointerDownOutside={(event) => event.preventDefault()}
      positioning={{ placement: 'bottom-end', gutter: 4 }}
      lazyMount
      unmountOnExit
    >
      <Menu.Trigger asChild>
        <IconButton label="Chat options" className={styles.utilityButton}>
          <MoreVertical />
        </IconButton>
      </Menu.Trigger>
      <MenuDismissLayer
        isOpen={isOpen}
        label="Dismiss chat menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={overlays.menu}>
            {!isSaved && (
              <Menu.Root positioning={{ placement: 'left-start', gutter: 6 }}>
                <Menu.TriggerItem className={overlays.menuItem}>
                  <Timer /> Auto-delete <ChevronLeft className={styles.submenuArrow} />
                </Menu.TriggerItem>
                <Menu.Positioner>
                  <Menu.Content className={overlays.menu}>
                    {AUTO_DELETE_OPTIONS.map((option) => (
                      <Menu.Item
                        key={option.days}
                        value={String(option.days)}
                        className={overlays.menuItem}
                        onSelect={() => onAutoDelete(option.days)}
                      >
                        <Timer />
                        {option.label}
                        <Ripple />
                      </Menu.Item>
                    ))}
                    <Menu.Item
                      value="other"
                      className={overlays.menuItem}
                      onSelect={() => onAction('auto-delete')}
                    >
                      <Timer />
                      Other
                      <Ripple />
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            )}
            {!isSaved && <Menu.Separator className={overlays.menuSeparator} />}
            <Menu.Item
              value="search"
              className={`${overlays.menuItem} ${styles.mobileSearch}`}
              onSelect={onSearch}
            >
              <Search />
              Search
              <Ripple />
            </Menu.Item>
            {!isSaved && (
              <Menu.Item
                value="mute"
                className={overlays.menuItem}
                onSelect={() => onAction('mute')}
              >
                {conversation.isMuted ? <Bell /> : <BellOff />}
                {conversation.isMuted ? 'Unmute' : 'Mute'}
                <Ripple />
              </Menu.Item>
            )}
            {(isGroup || conversation.kind === 'private') && (
              <Menu.Item
                value="call"
                className={overlays.menuItem}
                onSelect={() => onAction('call')}
              >
                <Video />
                {isGroup ? 'Video Chat' : 'Call'}
                <Ripple />
              </Menu.Item>
            )}
            <Menu.Item
              value="select"
              className={overlays.menuItem}
              onSelect={() => onAction('select')}
            >
              <CheckSquare />
              {isSelecting ? 'Clear Selection' : 'Select Messages'}
              <Ripple />
            </Menu.Item>
            <Menu.Item
              value="clear"
              className={overlays.menuItem}
              onSelect={() => onAction('clear')}
            >
              <MessageSquareX />
              Clear history
              <Ripple />
            </Menu.Item>
            <Menu.Item
              value="delete"
              className={`${overlays.menuItem} ${overlays.danger}`}
              onSelect={() => onAction('delete')}
            >
              <Trash2 />
              {getDeleteConversationLabel(conversation)}
              <Ripple />
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </MenuDismissLayer>
    </Menu.Root>
  );
}
