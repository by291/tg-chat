import { Menu } from '@ark-ui/react/menu';
import { Megaphone, MessageCircle, Pencil, Phone, Users, X } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import { MenuDismissLayer } from '../MenuDismissLayer';
import overlays from '../overlays.module.css';
import styles from './NewChat.module.css';

export type NewChatMode = 'group' | 'channel' | 'private' | 'call';

interface NewChatMenuProps {
  onChoose: (mode: NewChatMode) => void;
}

const CREATION_ACTIONS = [
  {
    mode: 'channel',
    label: 'New Channel',
    icon: Megaphone,
  },
  {
    mode: 'group',
    label: 'New Group',
    icon: Users,
  },
  {
    mode: 'call',
    label: 'New Group Call',
    icon: Phone,
  },
  {
    mode: 'private',
    label: 'New Private Chat',
    icon: MessageCircle,
  },
] as const;

/** Expand creation choices above the floating pencil without changing the active chat. */
export function NewChatMenu({ onChoose }: NewChatMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={(details) => setIsOpen(details.open)}
      positioning={{ placement: 'top-end', gutter: 8 }}
      onPointerDownOutside={(event) => event.preventDefault()}
    >
      <Menu.Trigger asChild>
        <IconButton label="New Chats" className={styles.composeButton} data-open={isOpen}>
          <Pencil className={styles.pencil} />
          <X className={styles.close} />
        </IconButton>
      </Menu.Trigger>
      <MenuDismissLayer
        isOpen={isOpen}
        label="Dismiss new chat menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={`${overlays.menu} ${styles.menu}`}>
            {CREATION_ACTIONS.map((action) => (
              <Menu.Item
                key={action.mode}
                value={action.mode}
                className={overlays.menuItem}
                onSelect={() => onChoose(action.mode)}
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
  );
}
