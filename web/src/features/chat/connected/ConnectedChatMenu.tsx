import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Archive, Bookmark, EyeOff, Menu as MenuIcon } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import overlays from '@/components/overlays/overlays.module.css';

/** Keep Saved Messages reachable from the main chat menu. */
export function ConnectedChatMenu({
  onOpenSaved,
  onOpenArchived,
  onOpenHidden,
}: {
  onOpenSaved: () => void;
  onOpenArchived: () => void;
  onOpenHidden: () => void;
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
