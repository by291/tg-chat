import type { EmojiMartData } from '@emoji-mart/data';
import { Clock3, Search, Smile } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadEmojiCatalog } from '../../composer/picker/emojiCatalog';
import { PickerGrid, type PickerGridControls } from '../../composer/picker/PickerGrid';
import { CUSTOM_EMOJI_PACKS } from '@/features/emoji/customEmojiCatalog';
import { StickerArtwork } from '@/features/stickers/StickerArtwork';
import { createReactionCatalog, searchReactionCatalog } from './reactionCatalog';
import styles from './ReactionPicker.module.css';

const REACTION_COLUMNS = 8;
const REACTION_ROW_HEIGHT = 42;

interface ReactionBrowserProps {
  selected: string[];
  onSelect: (options: { emoji: string; source: HTMLElement }) => void;
}

/** Browse the complete supported reaction catalog with virtual rows and searchable pack entries. */
export function ReactionBrowser({ selected, onSelect }: ReactionBrowserProps) {
  const [catalog, setCatalog] = useState<EmojiMartData>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState('popular');
  const [initialSection, setInitialSection] = useState('popular');
  const gridRef = useRef<PickerGridControls>(null);
  const isSearching = Boolean(query.trim());
  const catalogSections = useMemo(() => createReactionCatalog(catalog), [catalog]);
  const sections = useMemo(
    () => searchReactionCatalog({ sections: catalogSections, query }),
    [catalogSections, query],
  );
  const hasChoices = sections.some((section) => section.items.length > 0);
  const isCustomSection = CUSTOM_EMOJI_PACKS.some((pack) => pack.id === activeSection);

  useEffect(() => {
    let isCancelled = false;
    void loadEmojiCatalog()
      .then((loadedCatalog) => {
        if (!isCancelled) {
          setCatalog(loadedCatalog);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setError('Could not load all emoji. Close the panel and try again.');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  function selectSection(id: string) {
    if (isSearching) {
      setInitialSection(id);
      setQuery('');
      return;
    }

    gridRef.current?.scrollToSection(id);
  }

  return (
    <>
      <div className={styles.header} aria-label="Reaction categories">
        <button
          type="button"
          aria-label="Popular reactions"
          aria-pressed={!isSearching && activeSection === 'popular'}
          onClick={() => selectSection('popular')}
        >
          <Clock3 size={24} />
        </button>
        <button
          type="button"
          aria-label="All Emoji"
          disabled={!catalog}
          aria-pressed={!isSearching && activeSection !== 'popular' && !isCustomSection}
          onClick={() => selectSection('people')}
        >
          <Smile size={24} />
        </button>
        {CUSTOM_EMOJI_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            aria-label={pack.name}
            aria-pressed={!isSearching && activeSection === pack.id}
            onClick={() => selectSection(pack.id)}
          >
            <span className={styles.packIcon}>
              <StickerArtwork sticker={pack.emojis[0]} />
            </span>
          </button>
        ))}
      </div>
      <label className={styles.search}>
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="Search reactions"
          placeholder="Search Emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && (
        <p className={styles.empty} role="status">
          {error}
        </p>
      )}
      {!hasChoices && (
        <p className={styles.empty} role="status">
          {catalog ? 'No reactions found' : 'Loading emoji…'}
        </p>
      )}
      {hasChoices && (
        <PickerGrid
          key={isSearching ? `search:${query}` : 'categories'}
          sections={sections}
          columns={REACTION_COLUMNS}
          rowHeight={REACTION_ROW_HEIGHT}
          initialSectionId={isSearching ? undefined : initialSection}
          controlsRef={gridRef}
          onSectionChange={setActiveSection}
          renderItem={(item) => (
            <button
              key={item.value}
              type="button"
              className={styles.choice}
              aria-label={`React ${item.label}`}
              aria-pressed={selected.includes(item.value)}
              onClick={(event) => {
                const source =
                  event.currentTarget.querySelector<HTMLElement>('[data-reaction-emoji]');
                onSelect({ emoji: item.value, source: source ?? event.currentTarget });
              }}
            >
              <span className={styles.emoji} data-reaction-emoji={item.value}>
                {item.custom ? <StickerArtwork sticker={item.custom} /> : item.native}
              </span>
            </button>
          )}
        />
      )}
    </>
  );
}
