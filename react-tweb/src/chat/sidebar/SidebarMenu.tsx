import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Bookmark, Moon } from 'lucide-react';
import { useState, type Ref } from 'react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import overlays from '../overlays.module.css';
import styles from './ChatSidebar.module.css';

interface SidebarMenuProps {
  isSearching: boolean;
  isDark: boolean;
  menuButtonRef: Ref<HTMLButtonElement>;
  onCloseSearch: () => void;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: () => void;
}

/** Keep menu and back controls in the same place while their shared icon morphs. */
export function SidebarMenu({
  isSearching,
  isDark,
  menuButtonRef,
  onCloseSearch,
  onSelectChat,
  onToggleTheme,
}: SidebarMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
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
        <Portal>
          <div className={styles.menuLayer}>
            {isOpen && !isSearching && (
              <button
                type="button"
                className={styles.menuDismissTarget}
                aria-label="Dismiss main menu"
                tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsOpen(false);
                }}
              />
            )}
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
                <Menu.Item value="theme" className={overlays.menuItem} onSelect={onToggleTheme}>
                  <Moon /> {isDark ? 'Light mode' : 'Dark mode'}
                  <Ripple />
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </div>
        </Portal>
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
