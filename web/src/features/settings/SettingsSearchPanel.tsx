import { ArrowLeft, Search, SearchX, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isDismissKey } from '@/lib/keyboardEvent';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import {
  readRecentSettings,
  searchSettings,
  SETTINGS_CATEGORIES,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from './settingsSearch';
import settings from './SettingsPage.module.css';
import styles from './SettingsSearchPanel.module.css';

interface SearchResult {
  id: string;
  title: string;
  category: string;
  path: string;
}

interface SearchPanelProps<Item extends SearchResult> {
  isOpen: boolean;
  isCovered: boolean;
  onClose: () => void;
  onSelect: (item: Item) => void;
}

interface SearchCatalog<Item extends SearchResult> {
  search: (query: string) => Item[];
  recent: Item[];
  categoryFor: (item: Item) => { icon: LucideIcon; color: string };
}

/** Restore the local demo's recent destinations whenever its search opens. */
export function SettingsSearchPanel(props: SearchPanelProps<SettingsSearchItem>) {
  const [recent, setRecent] = useState<SettingsSearchItem[]>([]);
  useEffect(() => {
    if (props.isOpen) {
      const ids = readRecentSettings();
      setRecent(ids.flatMap((id) => SETTINGS_SEARCH_ITEMS.filter((item) => item.id === id)));
    }
  }, [props.isOpen]);

  return (
    <SettingsSearchResults
      {...props}
      recent={recent}
      search={searchSettings}
      categoryFor={(item) => SETTINGS_CATEGORIES.find((entry) => entry.id === item.category)!}
    />
  );
}

/** Search the destinations supplied by the current account or demo settings owner. */
export function SettingsSearchResults<Item extends SearchResult>({
  isOpen,
  isCovered,
  onClose,
  onSelect,
  recent,
  search,
  categoryFor,
}: SearchPanelProps<Item> & SearchCatalog<Item>) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = Boolean(query.trim());
  const items = hasQuery ? search(query) : recent;

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !isCovered) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen, isCovered]);

  function clearSearch() {
    if (!query) {
      onClose();
      return;
    }

    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <section
      className={styles.searchLayer}
      aria-label="Settings search"
      aria-hidden={!isOpen}
      inert={!isOpen}
      onKeyDown={(event) => {
        if (isDismissKey(event.nativeEvent)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={styles.searchHeader}>
        <IconButton label="Back from settings search" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <div className={styles.inputWrap}>
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Search settings"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            label={query ? 'Clear settings search' : 'Close settings search'}
            onClick={clearSearch}
          >
            <X />
          </IconButton>
        </div>
      </header>
      <div className={`${settings.scrollContent} ${styles.results}`}>
        {items.length > 0 && (
          <section
            className={settings.section}
            aria-label={hasQuery ? 'Search results' : 'Recent settings'}
          >
            {!hasQuery && <h3>Recent</h3>}
            {items.map((item, index) => {
              const category = categoryFor(item);
              const Icon = category.icon;
              const isFirstInCategory = index === 0 || items[index - 1].category !== item.category;

              return (
                <button
                  key={item.id}
                  className={styles.result}
                  aria-label={[item.title, item.path].filter(Boolean).join(' ')}
                  onClick={() => onSelect(item)}
                >
                  <span className={styles.categoryIcon}>
                    {isFirstInCategory && (
                      <span className={settings.icon} data-color={category.color}>
                        <Icon aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className={styles.resultText}>
                    <span>{item.title}</span>
                    {item.path && <small>{item.path}</small>}
                  </span>
                  <Ripple />
                </button>
              );
            })}
          </section>
        )}
        {hasQuery && items.length === 0 && (
          <div className={styles.empty} role="status">
            <SearchX aria-hidden="true" />
            <p>No results</p>
          </div>
        )}
      </div>
    </section>
  );
}
