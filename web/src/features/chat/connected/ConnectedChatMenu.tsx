import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Archive, Bookmark, EyeOff, Megaphone, Menu as MenuIcon, Users } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import type { CommunityKind } from '../../communities/communityModels';
import overlays from '@/components/overlays/overlays.module.css';

/** Open common chat destinations and creation flows from the main menu. */
export function ConnectedChatMenu({
  onOpenSaved,
  onOpenArchived,
  onOpenHidden,
  onCreate,
}: {
  onOpenSaved: () => void;
  onOpenArchived: () => void;
  onOpenHidden: () => void;
  onCreate: (kind: CommunityKind) => void;
}) {
  return (
    <Menu.Root positioning={{ placement: 'bottom-start', gutter: 8 }}>
      <Menu.Trigger asChild>
        <IconButton label="Main menu">
          <MenuIcon />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={overlays.menu}>
            <Menu.Item
              value="new-group"
              className={overlays.menuItem}
              onSelect={() => onCreate('group')}
            >
              <Users aria-hidden="true" /> New Group
            </Menu.Item>
            <Menu.Item
              value="new-channel"
              className={overlays.menuItem}
              onSelect={() => onCreate('channel')}
            >
              <Megaphone aria-hidden="true" /> New Channel
            </Menu.Item>
            <Menu.Separator className={overlays.menuSeparator} />
            <Menu.Item value="saved" className={overlays.menuItem} onSelect={onOpenSaved}>
              <Bookmark aria-hidden="true" /> Saved Messages
            </Menu.Item>
            <Menu.Item value="archived" className={overlays.menuItem} onSelect={onOpenArchived}>
              <Archive aria-hidden="true" /> Archived Chats
            </Menu.Item>
            <Menu.Item value="hidden" className={overlays.menuItem} onSelect={onOpenHidden}>
              <EyeOff aria-hidden="true" /> Hidden Chats
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
