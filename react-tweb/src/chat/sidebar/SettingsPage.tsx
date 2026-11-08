import { Keyboard, Search, Settings, Sticker, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ThemeOrigin } from '../../app/useThemeTransition';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { SidebarNavigation } from './SidebarNavigation';
import { GeneralSettingsPage } from './GeneralSettingsPage';
import { StickerSettingsPage } from './StickerSettingsPage';
import { SettingsHeader, SettingsRow } from './SettingsControls';
import { useClosingDialogValue } from './useClosingDialogValue';
import styles from './SettingsPage.module.css';

const SETTINGS_CATEGORIES = [
  {
    id: 'general',
    label: 'General Settings',
    keywords:
      'appearance theme light dark mode text size time format autoplay video power animation',
    icon: Settings,
    color: 'gray',
  },
  {
    id: 'stickers',
    label: 'Stickers and Emoji',
    keywords: 'animation loop packs emoticons large emoji dynamic order sort',
    icon: Sticker,
    color: 'pink',
  },
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    keywords: 'keyboard send message enter newline escape',
    icon: Keyboard,
    color: 'orange',
  },
] as const;

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id'];

interface SettingsPageProps {
  isDark: boolean;
  onToggleTheme: (origin?: ThemeOrigin) => void;
  onBack: () => void;
}

/** Browse supported preferences without replacing the conversation or losing sidebar state. */
export function SettingsPage({ isDark, onToggleTheme, onBack }: SettingsPageProps) {
  const [category, setCategory] = useState<SettingsCategory>();
  const closingCategory = useClosingDialogValue(category);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const categories = SETTINGS_CATEGORIES.filter((entry) => {
    const searchableText = `${entry.label} ${entry.keywords}`.toLowerCase();
    return searchableText.includes(normalizedQuery);
  });

  function closeSearch() {
    setIsSearching(false);
    setQuery('');
    searchButtonRef.current?.focus();
  }

  function navigateBack() {
    if (category) {
      setCategory(undefined);
      return;
    }
    if (isSearching) {
      closeSearch();
      return;
    }
    onBack();
  }

  let detailPage = (
    <GeneralSettingsPage
      isDark={isDark}
      onToggleTheme={onToggleTheme}
      onBack={() => setCategory(undefined)}
    />
  );
  if (closingCategory === 'stickers') {
    detailPage = <StickerSettingsPage onBack={() => setCategory(undefined)} />;
  } else if (closingCategory === 'shortcuts') {
    detailPage = <KeyboardSettingsPage onBack={() => setCategory(undefined)} />;
  }

  const overview = (
    <section className={styles.page} aria-label="Settings">
      <SettingsHeader title="Settings" backLabel="Back from settings" onBack={navigateBack}>
        <IconButton
          ref={searchButtonRef}
          label="Search settings"
          onClick={() => setIsSearching(true)}
        >
          <Search />
        </IconButton>
      </SettingsHeader>
      {isSearching && (
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
            autoFocus
            aria-label="Search settings"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton label="Close settings search" onClick={closeSearch}>
            <X />
          </IconButton>
        </div>
      )}
      <div className={styles.scrollContent}>
        {!isSearching && (
          <div className={styles.profile}>
            <Avatar initials="Y" color="purple" size="large" />
            <h3>You</h3>
            <p>online</p>
          </div>
        )}
        {categories.length > 0 ? (
          <div className={styles.section}>
            {categories.map((entry) => (
              <SettingsRow
                key={entry.id}
                label={entry.label}
                icon={entry.icon}
                color={entry.color}
                onClick={() => setCategory(entry.id)}
              />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No settings found</p>
        )}
      </div>
    </section>
  );

  return (
    <div
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          navigateBack();
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={Boolean(category)}
        primary={overview}
        secondary={detailPage}
      />
    </div>
  );
}

function KeyboardSettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <section className={styles.page} aria-label="Keyboard Shortcuts">
      <SettingsHeader
        title="Keyboard Shortcuts"
        backLabel="Back from keyboard shortcuts"
        onBack={onBack}
      />
      <div className={styles.scrollContent}>
        <dl className={`${styles.section} ${styles.shortcuts}`}>
          <div>
            <dt>Send message</dt>
            <dd>
              <kbd>Enter</kbd>
            </dd>
          </div>
          <div>
            <dt>New line</dt>
            <dd>
              <kbd>Shift + Enter</kbd>
            </dd>
          </div>
          <div>
            <dt>Close or go back</dt>
            <dd>
              <kbd>Esc</kbd>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
