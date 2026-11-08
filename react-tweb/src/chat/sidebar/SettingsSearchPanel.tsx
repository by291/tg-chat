import { ArrowLeft, Search, SearchX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import {
  readRecentSettings,
  searchSettings,
  SETTINGS_CATEGORIES,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from './settingsSearch';
import settings from './SettingsPage.module.css';
import styles from './SettingsSearchPanel.module.css';

interface SettingsSearchPanelProps {
  isOpen: boolean;
  isCovered: boolean;
  onClose: () => void;
  onSelect: (item: SettingsSearchItem) => void;
}

/** Keep queries and result scroll position when returning from a selected settings page. */
export function SettingsSearchPanel({
  isOpen,
  isCovered,
  onClose,
  onSelect,
}: SettingsSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = Boolean(query.trim());
  const items = hasQuery
    ? searchSettings(query)
    : recentIds.flatMap((id) => SETTINGS_SEARCH_ITEMS.filter((item) => item.id === id));

  useEffect(() => {
    if (isOpen) {
      setRecentIds(readRecentSettings());
    } else {
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
        if (event.key === 'Escape' && !event.defaultPrevented) {
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
              const category = SETTINGS_CATEGORIES.find((entry) => entry.id === item.category)!;
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
