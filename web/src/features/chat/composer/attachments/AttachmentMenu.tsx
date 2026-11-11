import { Menu } from '@ark-ui/react/menu';
import {
  ChartNoAxesColumn,
  CircleCheck,
  File,
  Image,
  Paperclip,
  TextCursorInput,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/components/overlays/MenuDismissLayer';
import overlays from '@/components/overlays/overlays.module.css';
import styles from './AttachmentMenu.module.css';

const ACTIONS = [
  {
    value: 'media',
    label: 'Photo or Video',
    icon: Image,
  },
  {
    value: 'document',
    label: 'Document',
    icon: File,
  },
  {
    value: 'article',
    label: 'Article',
    icon: TextCursorInput,
  },
  {
    value: 'poll',
    label: 'Poll',
    icon: ChartNoAxesColumn,
  },
  {
    value: 'checklist',
    label: 'Checklist',
    icon: CircleCheck,
  },
  {
    value: 'contact',
    label: 'Contact',
    icon: UserRound,
  },
] satisfies {
  value: AttachmentAction;
  label: string;
  icon: typeof Image;
}[];

export type AttachmentAction = 'media' | 'document' | 'article' | 'poll' | 'checklist' | 'contact';

interface AttachmentMenuProps {
  isDisabled: boolean;
  isConnected?: boolean;
  isMediaAvailable?: boolean;
  canShareContact?: boolean;
  canSendPoll?: boolean;
  isExpanded: boolean;
  onSelect: (action: AttachmentAction) => void;
}

/** Open attachment choices before requesting a file, preserving the composer's draft. */
export function AttachmentMenu({
  isDisabled,
  isConnected = false,
  isMediaAvailable = false,
  canShareContact = false,
  canSendPoll = false,
  isExpanded,
  onSelect,
}: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const actions = ACTIONS.filter((action) => {
    if (action.value === 'contact') {
      return canShareContact;
    }
    if (isConnected && action.value === 'poll') {
      return canSendPoll;
    }
    if (isConnected) {
      return isMediaAvailable && (action.value === 'media' || action.value === 'document');
    }
    return !isExpanded || action.value !== 'article';
  });

  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={({ open }) => setIsOpen(open)}
      onPointerDownOutside={(event) => event.preventDefault()}
      positioning={{ placement: 'top-start', gutter: 8 }}
      onSelect={({ value }) => {
        const action = ACTIONS.find((entry) => entry.value === value);
        if (action) {
          onSelect(action.value);
        }
      }}
    >
      <Menu.Trigger asChild>
        <IconButton label="Attach" className={styles.trigger} disabled={isDisabled}>
          <Paperclip />
        </IconButton>
      </Menu.Trigger>
      <MenuDismissLayer
        isOpen={isOpen}
        label="Dismiss attachment menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={`${overlays.menu} ${styles.menu}`} aria-label="Attachments">
            {actions.map((action) => (
              <Menu.Item key={action.value} value={action.value} className={overlays.menuItem}>
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
