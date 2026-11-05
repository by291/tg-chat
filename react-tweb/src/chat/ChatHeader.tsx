import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { ArrowLeft, Info, MoreVertical, Moon, Search, X } from 'lucide-react';
import { Avatar } from '../shared/Avatar';
import { IconButton } from '../shared/IconButton';
import type { Conversation } from './model';
import styles from './ChatHeader.module.css';
import overlays from './overlays.module.css';

interface ChatHeaderProps {
  conversation: Conversation;
  isSearchOpen: boolean;
  searchQuery: string;
  searchResultCount: number;
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
  onSearchQueryChange,
  onToggleSearch,
  onOpenDetails,
  onBack,
  onToggleTheme,
}: ChatHeaderProps) {
  return (
    <div className={styles.headerStack}>
      <header className={styles.header}>
        <IconButton label="Back to chats" className={styles.backButton} onClick={onBack}>
          <ArrowLeft />
        </IconButton>
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
        <IconButton label="Search messages" onClick={onToggleSearch} aria-pressed={isSearchOpen}>
          <Search />
        </IconButton>
        <Menu.Root positioning={{ placement: 'bottom-end' }}>
          <Menu.Trigger asChild>
            <IconButton label="Chat options">
              <MoreVertical />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content className={overlays.menu}>
                <Menu.Item value="info" className={overlays.menuItem} onSelect={onOpenDetails}>
                  <Info /> Chat information
                </Menu.Item>
                <Menu.Item value="search" className={overlays.menuItem} onSelect={onToggleSearch}>
                  <Search /> Search messages
                </Menu.Item>
                <Menu.Item value="theme" className={overlays.menuItem} onSelect={onToggleTheme}>
                  <Moon /> Change appearance
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
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
