import type { Emoji, EmojiMartData } from '@emoji-mart/data';
import { Clock3, Smile } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RECENT_EMOJI,
  EMOJI_CATEGORY_NAMES,
  loadEmojiCatalog,
  searchEmoji,
} from './emojiCatalog';
import { CUSTOM_EMOJI_PACKS, type CustomEmoji } from '@/features/emoji/customEmojiCatalog';
import { StickerArtwork } from '@/features/stickers/StickerArtwork';
import { CustomEmojiCell } from './CustomEmojiCell';
import { createCustomEmojiSections } from './customEmojiSections';
import { EmojiCell } from './EmojiCell';
import { PickerGrid, type PickerGridControls } from './PickerGrid';
import { PickerSearch } from './PickerSearch';
import { PickerResults } from './PickerResults';
import { normalizeGroupEmoji, type EmojiSearchGroup } from './emojiSearchGroups';
import styles from './EmojiPicker.module.css';

const EMOJI_COLUMNS = 8;
const EMOJI_ROW_HEIGHT = 42;
const SEARCH_DEBOUNCE = 100;
const RECENT_EMOJI_LIMIT = 32;

interface EmojiBrowserProps {
  recentEmoji: string[];
  tones: Record<string, number>;
  onSelect: (emoji: Emoji) => void;
  onSelectCustomEmoji?: (emoji: CustomEmoji) => void;
  onToneChange: (id: string, tone: number) => void;
}

/** Browse categorized Unicode emoji with lazy data, indexed search, and virtual rows. */
export function EmojiBrowser({
  recentEmoji,
  tones,
  onSelect,
  onSelectCustomEmoji,
  onToneChange,
}: EmojiBrowserProps) {
  const [catalog, setCatalog] = useState<EmojiMartData>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<EmojiSearchGroup>();
  const isFiltering = Boolean(query.trim()) || Boolean(selectedGroup);
  const isSearching = isSearchFocused || isFiltering;
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
    if (selectedGroup) {
      const emojiByNative = new Map(
        Object.values(catalog.emojis).map((emoji) => [
          normalizeGroupEmoji(emoji.skins[0].native),
          emoji,
        ]),
      );
      const items = selectedGroup.emoticons.flatMap((emoticon) => {
        const emoji = emojiByNative.get(emoticon);
        return emoji ? [emoji] : [];
      });
      return [
        {
          id: selectedGroup.id,
          title: selectedGroup.label,
          items,
        },
      ];
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
  }, [catalog, matches, query, selectedGroup, sessionRecents]);

  const combinedSections = useMemo(
    () =>
      createCustomEmojiSections({
        sections,
        recentIds: sessionRecents,
        query,
        selectedGroup,
        matches,
        shouldIncludeCustomEmoji: Boolean(onSelectCustomEmoji),
      }),
    [sections, sessionRecents, query, selectedGroup, matches, onSelectCustomEmoji],
  );
  const hasResults = combinedSections.some((section) => section.items.length > 0);
  const isCustomSection = CUSTOM_EMOJI_PACKS.some((pack) => pack.id === activeSection);

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
          aria-pressed={activeSection !== 'recent' && !isCustomSection}
          onClick={() => gridRef.current?.scrollToSection('people')}
        >
          <Smile size={24} />
        </button>
        {onSelectCustomEmoji &&
          CUSTOM_EMOJI_PACKS.map((pack) => (
            <button
              key={pack.id}
              aria-label={pack.name}
              aria-pressed={activeSection === pack.id}
              onClick={() => gridRef.current?.scrollToSection(pack.id)}
            >
              <span className={styles.emojiPackIcon}>
                <StickerArtwork sticker={pack.emojis[0]} />
              </span>
            </button>
          ))}
      </div>
      <PickerSearch
        label="Search Emoji"
        query={query}
        selectedGroup={selectedGroup}
        onQueryChange={setQuery}
        onFocusChange={(details) => setIsSearchFocused(details.isFocused)}
        onGroupChange={setSelectedGroup}
      />
      <PickerResults viewKey={selectedGroup?.id ?? (query.trim() ? 'search' : 'categories')}>
        {!catalog && <p className={styles.empty}>{error || 'Loading emoji…'}</p>}
        {catalog && isFiltering && !hasResults && (
          <p className={styles.empty}>{isLoadingSearch ? 'Searching…' : 'No emoji found'}</p>
        )}
        {catalog && (!isFiltering || hasResults) && (
          <PickerGrid
            sections={combinedSections}
            columns={EMOJI_COLUMNS}
            rowHeight={EMOJI_ROW_HEIGHT}
            controlsRef={isFiltering ? undefined : gridRef}
            onSectionChange={isFiltering ? undefined : setActiveSection}
            renderItem={(item) => {
              if (item.kind === 'custom') {
                if (!onSelectCustomEmoji) {
                  return null;
                }
                return (
                  <CustomEmojiCell
                    key={item.emoji.id}
                    emoji={item.emoji}
                    onSelect={onSelectCustomEmoji}
                  />
                );
              }
              return (
                <EmojiCell
                  key={item.emoji.id}
                  emoji={item.emoji}
                  tone={tones[item.emoji.id] ?? 0}
                  onSelect={onSelect}
                  onToneChange={onToneChange}
                />
              );
            }}
          />
        )}
      </PickerResults>
    </div>
  );
}
