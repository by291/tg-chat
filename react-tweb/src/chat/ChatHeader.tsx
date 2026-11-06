import { Menu } from '@ark-ui/react/menu';
import { ArrowLeft, Info, MoreVertical, Moon, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../components/Avatar';
import { IconButton } from '../components/IconButton';
import { Ripple } from '../components/Ripple';
import { MenuDismissLayer } from './MenuDismissLayer';
import type { Conversation } from './model';
import styles from './ChatHeader.module.css';
import overlays from './overlays.module.css';

interface ChatHeaderProps {
  conversation: Conversation;
  isSearchOpen: boolean;
  searchQuery: string;
  searchResultCount: number;
  pinnedCount?: number;
  onSearchQueryChange: (query: string) => void;
  onToggleSearch: () => void;
  onOpenDetails: () => void;
  onBack: () => void;
  onToggleTheme: () => void;
}

/** Render the floating conversation toolbar and its inline history search. */
export function ChatHeader({
  conversation,
  isSearchOpen,
  searchQuery,
  searchResultCount,
  pinnedCount,
  onSearchQueryChange,
  onToggleSearch,
  onOpenDetails,
  onBack,
  onToggleTheme,
}: ChatHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isPinnedView = pinnedCount !== undefined;

  return (
    <div className={styles.headerStack}>
      <header className={styles.header} data-pinned-view={isPinnedView}>
        <IconButton
          label={isPinnedView ? 'Back to conversation' : 'Back to chats'}
          className={styles.backButton}
          onClick={onBack}
        >
          <ArrowLeft />
        </IconButton>
        {isPinnedView ? (
          <div className={styles.pinnedTitle}>
            <strong>Pinned Messages</strong>
            <span>{pinnedCount === 1 ? '1 message' : `${pinnedCount} messages`}</span>
          </div>
        ) : (
          <button
            className={styles.identity}
            onClick={onOpenDetails}
            aria-label="Open chat information"
          >
            <Avatar initials={conversation.initials} color={conversation.color} size="small" />
            <span className={styles.identityText}>
              <strong>{conversation.title}</strong>
              <span>{conversation.subtitle}</span>
            </span>
          </button>
        )}
        <IconButton
          label="Search messages"
          className={`${styles.utilityButton} ${styles.searchButton}`}
          onClick={onToggleSearch}
          aria-pressed={isSearchOpen}
        >
          <Search />
        </IconButton>
        <Menu.Root
          open={isMenuOpen}
          onOpenChange={(details) => setIsMenuOpen(details.open)}
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
            isOpen={isMenuOpen}
            label="Dismiss chat menu"
            onDismiss={() => setIsMenuOpen(false)}
          >
            <Menu.Positioner>
              <Menu.Content className={overlays.menu}>
                <Menu.Item value="info" className={overlays.menuItem} onSelect={onOpenDetails}>
                  <Info /> Chat information
                  <Ripple />
                </Menu.Item>
                <Menu.Item value="search" className={overlays.menuItem} onSelect={onToggleSearch}>
                  <Search /> Search messages
                  <Ripple />
                </Menu.Item>
                <Menu.Item value="theme" className={overlays.menuItem} onSelect={onToggleTheme}>
                  <Moon /> Change appearance
                  <Ripple />
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </MenuDismissLayer>
        </Menu.Root>
      </header>
      {isSearchOpen && (
        <div className={styles.searchBar}>
          <Search size={20} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onToggleSearch();
              }
            }}
            placeholder="Search in this conversation"
            aria-label="Search in this conversation"
          />
          <span className={styles.resultCount}>{searchQuery && `${searchResultCount} found`}</span>
          <IconButton label="Close search" onClick={onToggleSearch}>
            <X />
          </IconButton>
        </div>
      )}
    </div>
  );
}
