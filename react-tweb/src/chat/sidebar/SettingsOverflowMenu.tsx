import { Menu } from '@ark-ui/react/menu';
import { LogOut, MoreVertical, Pencil, QrCode } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { MenuDismissLayer } from '../MenuDismissLayer';
import overlays from '../overlays.module.css';
import styles from './SettingsOverflowMenu.module.css';

/** Keep account-only actions visible without pretending that the demo has authenticated sessions. */
export function SettingsOverflowMenu() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={({ open }) => setIsOpen(open)}
      positioning={{ placement: 'bottom-end', gutter: 8 }}
      onPointerDownOutside={(event) => event.preventDefault()}
      lazyMount
      unmountOnExit
    >
      <Menu.Trigger asChild>
        <IconButton label="More settings">
          <MoreVertical />
        </IconButton>
      </Menu.Trigger>
      <MenuDismissLayer
        isOpen={isOpen}
        label="Dismiss settings menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={`${overlays.menu} ${styles.menu}`} aria-label="Settings actions">
            <Menu.Item value="edit" className={overlays.menuItem} disabled>
              <Pencil aria-hidden="true" />
              Edit Profile
            </Menu.Item>
            <Menu.Item value="qr" className={overlays.menuItem} disabled>
              <QrCode aria-hidden="true" />
              QR Code
            </Menu.Item>
            <Menu.Item
              value="logout"
              className={`${overlays.menuItem} ${overlays.danger}`}
              disabled
            >
              <LogOut aria-hidden="true" />
              Log Out
            </Menu.Item>
            <p className={styles.notice}>Requires account backend</p>
          </Menu.Content>
        </Menu.Positioner>
      </MenuDismissLayer>
    </Menu.Root>
  );
}
