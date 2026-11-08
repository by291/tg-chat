import { Menu } from '@ark-ui/react/menu';
import { Archive, Bookmark, Moon, Settings } from 'lucide-react';
import { useRef, useState, type Ref } from 'react';
import type { ThemeOrigin } from '../../app/useThemeTransition';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import { MenuDismissLayer } from '../MenuDismissLayer';
import overlays from '../overlays.module.css';
import styles from './ChatSidebar.module.css';

interface SidebarMenuProps {
  isSearching: boolean;
  isDark: boolean;
  menuButtonRef: Ref<HTMLButtonElement>;
  onCloseSearch: () => void;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: (origin?: ThemeOrigin) => void;
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  archiveUnreadCount: number;
}

/** Keep menu and back controls in the same place while their shared icon morphs. */
export function SidebarMenu({
  isSearching,
  isDark,
  menuButtonRef,
  onCloseSearch,
  onSelectChat,
  onToggleTheme,
  onOpenArchive,
  onOpenSettings,
  archiveUnreadCount,
}: SidebarMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const themeIconRef = useRef<SVGSVGElement>(null);
  const navigationIcon = (
    <span className={styles.menuIcon} data-back={isSearching} aria-hidden="true" />
  );

  return (
    <div className={styles.navigationControl}>
      <Menu.Root
        open={isOpen && !isSearching}
        onOpenChange={(details) => setIsOpen(details.open)}
        onPointerDownOutside={(event) => {
          // The dismissal layer consumes the complete click before the menu closes.
          event.preventDefault();
        }}
        positioning={{ placement: 'bottom-start', gutter: 8 }}
      >
        <Menu.Trigger asChild>
          <IconButton
            ref={menuButtonRef}
            label="Main menu"
            className={styles.navigationButton}
            data-visible={!isSearching}
            aria-hidden={isSearching}
            tabIndex={isSearching ? -1 : 0}
          >
            {navigationIcon}
          </IconButton>
        </Menu.Trigger>
        <MenuDismissLayer
          isOpen={isOpen && !isSearching}
          label="Dismiss main menu"
          onDismiss={() => setIsOpen(false)}
        >
          <Menu.Positioner>
            <Menu.Content className={`${overlays.menu} ${styles.mainMenu}`}>
              <Menu.Item
                value="saved"
                className={overlays.menuItem}
                onSelect={() => onSelectChat('saved')}
              >
                <Bookmark /> Saved Messages
                <Ripple />
              </Menu.Item>
              <Menu.Item value="archive" className={overlays.menuItem} onSelect={onOpenArchive}>
                <Archive /> Archived Chats
                {archiveUnreadCount > 0 && (
                  <span className={styles.archiveMenuCount}>{archiveUnreadCount}</span>
                )}
                <Ripple />
              </Menu.Item>
              <Menu.Item
                value="theme"
                className={overlays.menuItem}
                onSelect={() => {
                  const bounds = themeIconRef.current?.getBoundingClientRect();
                  const origin = bounds
                    ? { left: bounds.left + bounds.width / 2, top: bounds.top + bounds.height / 2 }
                    : undefined;
                  onToggleTheme(origin);
                }}
              >
                <Moon ref={themeIconRef} /> {isDark ? 'Light mode' : 'Dark mode'}
                <Ripple />
              </Menu.Item>
              <Menu.Item value="settings" className={overlays.menuItem} onSelect={onOpenSettings}>
                <Settings /> Settings
                <Ripple />
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </MenuDismissLayer>
      </Menu.Root>
      <IconButton
        label="Close search"
        className={styles.navigationButton}
        data-visible={isSearching}
        aria-hidden={!isSearching}
        tabIndex={isSearching ? 0 : -1}
        onClick={onCloseSearch}
      >
        {navigationIcon}
      </IconButton>
    </div>
  );
}
