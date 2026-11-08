import { Menu } from '@ark-ui/react/menu';
import {
  ChartNoAxesColumn,
  CircleCheck,
  File,
  Image,
  Paperclip,
  TextCursorInput,
} from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/components/overlays/MenuDismissLayer';
import overlays from '@/components/overlays/overlays.module.css';
import styles from './AttachmentMenu.module.css';

const ACTIONS = [
  { value: 'media', label: 'Photo or Video', icon: Image },
  { value: 'document', label: 'Document', icon: File },
  { value: 'article', label: 'Article', icon: TextCursorInput },
  { value: 'poll', label: 'Poll', icon: ChartNoAxesColumn },
  { value: 'checklist', label: 'Checklist', icon: CircleCheck },
] satisfies { value: AttachmentAction; label: string; icon: typeof Image }[];

export type AttachmentAction = 'media' | 'document' | 'article' | 'poll' | 'checklist';

interface AttachmentMenuProps {
  isDisabled: boolean;
  isExpanded: boolean;
  onSelect: (action: AttachmentAction) => void;
}

/** Open attachment choices before requesting a file, preserving the composer's draft. */
export function AttachmentMenu({ isDisabled, isExpanded, onSelect }: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

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
            {ACTIONS.filter((action) => !isExpanded || action.value !== 'article').map((action) => (
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
