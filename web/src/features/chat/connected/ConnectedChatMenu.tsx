import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Bookmark, Menu as MenuIcon } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import overlays from '@/components/overlays/overlays.module.css';

/** Keep Saved Messages reachable from the main chat menu. */
export function ConnectedChatMenu({ onOpenSaved }: { onOpenSaved: () => void }) {
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
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
