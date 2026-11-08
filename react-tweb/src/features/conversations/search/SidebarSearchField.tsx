import { Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import { IconButton } from '@/components/IconButton';
import styles from '../ChatSidebar.module.css';

interface SidebarSearchFieldProps {
  query: string;
  isArchiveScope: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onFocus: () => void;
  onQueryChange: (query: string) => void;
  onClearQuery: () => void;
  onSearchAllChats: () => void;
}

/** Display the search input and its removable archive scope. */
export function SidebarSearchField({
  query,
  isArchiveScope,
  inputRef,
  onFocus,
  onQueryChange,
  onClearQuery,
  onSearchAllChats,
}: SidebarSearchFieldProps) {
  return (
    <div className={styles.searchField} data-archive={isArchiveScope}>
      <Search className={styles.searchIcon} size={24} aria-hidden="true" />
      {isArchiveScope && (
        <button
          type="button"
          className={styles.archiveSearchScope}
          aria-label="Search all chats"
          onClick={onSearchAllChats}
        >
          Archive <X size={14} />
        </button>
      )}
      <input
        ref={inputRef}
        aria-label="Search conversations"
        placeholder="Search"
        value={query}
        onFocus={onFocus}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {query && (
        <IconButton label="Clear search" className={styles.clearSearch} onClick={onClearQuery}>
          <X />
        </IconButton>
      )}
    </div>
  );
}
