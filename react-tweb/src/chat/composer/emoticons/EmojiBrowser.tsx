import type { Emoji, EmojiMartData } from '@emoji-mart/data';
import { Clock3, Smile } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RECENT_EMOJI,
  EMOJI_CATEGORY_NAMES,
  loadEmojiCatalog,
  searchEmoji,
} from './emojiCatalog';
import { EmojiCell } from './EmojiCell';
import { PickerGrid, type PickerGridControls } from './PickerGrid';
import { PickerSearch } from './PickerSearch';
import styles from '../EmojiPicker.module.css';

const EMOJI_COLUMNS = 8;
const EMOJI_ROW_HEIGHT = 42;
const SEARCH_DEBOUNCE = 100;
const RECENT_EMOJI_LIMIT = 32;

interface EmojiBrowserProps {
  recentEmoji: string[];
  tones: Record<string, number>;
  onSelect: (emoji: Emoji) => void;
  onToneChange: (id: string, tone: number) => void;
}

/** Browse categorized Unicode emoji with lazy data, indexed search, and virtual rows. */
export function EmojiBrowser({ recentEmoji, tones, onSelect, onToneChange }: EmojiBrowserProps) {
  const [catalog, setCatalog] = useState<EmojiMartData>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [matches, setMatches] = useState<Emoji[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [activeSection, setActiveSection] = useState('recent');
  const gridRef = useRef<PickerGridControls>(null);
  // Updating recents must not shuffle the button underneath a repeated click.
  const [sessionRecents] = useState(() =>
    [...new Set([...recentEmoji, ...DEFAULT_RECENT_EMOJI])].slice(0, RECENT_EMOJI_LIMIT),
  );

  useEffect(() => {
    let isCancelled = false;
    loadEmojiCatalog()
      .then((loaded) => {
        if (!isCancelled) {
          setCatalog(loaded);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setError('Could not load emoji. Close the panel and try again.');
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    setIsLoadingSearch(Boolean(query.trim()));
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setMatches([]);
        return;
      }
      searchEmoji(query)
        .then((found) => {
          if (!isCancelled) {
            setMatches(found);
            setIsLoadingSearch(false);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setMatches([]);
            setIsLoadingSearch(false);
          }
        });
    }, SEARCH_DEBOUNCE);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const sections = useMemo(() => {
    if (!catalog) {
      return [];
    }
    if (query.trim()) {
      return [
        {
          id: 'results',
          title: 'Search Results',
          items: matches,
        },
      ];
    }
    return [
      {
        id: 'recent',
        title: 'Frequently Used',
        items: sessionRecents.map((id) => catalog.emojis[id]).filter(Boolean),
      },
      ...catalog.categories
        .filter((category) => category.id !== 'frequent')
        .map((category) => ({
          id: category.id,
          title: EMOJI_CATEGORY_NAMES[category.id] ?? category.id,
          items: category.emojis.map((id) => catalog.emojis[id]).filter(Boolean),
        })),
    ];
  }, [catalog, matches, query, sessionRecents]);

  return (
    <div className={styles.browser} data-searching={isSearching}>
      <div className={styles.packBar} aria-label="Emoji categories">
        <button
          aria-label="Frequently Used"
          aria-pressed={activeSection === 'recent'}
          onClick={() => gridRef.current?.scrollToSection('recent')}
        >
          <Clock3 size={24} />
        </button>
        <button
          aria-label="All Emoji"
          aria-pressed={activeSection !== 'recent'}
          onClick={() => gridRef.current?.scrollToSection('people')}
        >
          <Smile size={24} />
        </button>
      </div>
      <PickerSearch
        label="Search Emoji"
        query={query}
        isSearching={isSearching}
        onQueryChange={setQuery}
        onSearchingChange={setIsSearching}
      />
      {!catalog && <p className={styles.empty}>{error || 'Loading emoji…'}</p>}
      {catalog && query.trim() && matches.length === 0 ? (
        <p className={styles.empty}>{isLoadingSearch ? 'Searching…' : 'No emoji found'}</p>
      ) : (
        <PickerGrid
          key={query.trim() ? 'search' : 'categories'}
          sections={sections}
          columns={EMOJI_COLUMNS}
          rowHeight={EMOJI_ROW_HEIGHT}
          controlsRef={gridRef}
          onSectionChange={setActiveSection}
          renderItem={(emoji) => (
            <EmojiCell
              key={emoji.id}
              emoji={emoji}
              tone={tones[emoji.id] ?? 0}
              onSelect={onSelect}
              onToneChange={onToneChange}
            />
          )}
        />
      )}
    </div>
  );
}
