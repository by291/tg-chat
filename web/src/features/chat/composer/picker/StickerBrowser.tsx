import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { Clock3, Star, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '@/features/settings/appPreferences';
import { getOrderedStickerPacks } from '@/features/stickers/stickerPackOrder';
import { STICKERS, STICKER_PACKS, type Sticker } from '@/features/stickers/stickerCatalog';
import { StickerPlaybackScope } from '@/features/stickers/StickerPlaybackScope';
import { PickerGrid, type PickerGridControls, type PickerSection } from './PickerGrid';
import { PickerSearch } from './PickerSearch';
import { PickerResults } from './PickerResults';
import { matchesEmojiGroup, type EmojiSearchGroup } from './emojiSearchGroups';
import { StickerCell } from './StickerCell';
import styles from './EmojiPicker.module.css';

const STICKER_COLUMNS = 5;
const STICKER_ROW_HEIGHT = 76;

interface StickerBrowserProps {
  recentStickers: string[];
  favoriteStickers: string[];
  onSelect: (sticker: Sticker) => void;
  onToggleFavorite: (id: string) => void;
}

/** Browse installed local packs, search their tags, and inspect a pack without sending it. */
export function StickerBrowser({
  recentStickers,
  favoriteStickers,
  onSelect,
  onToggleFavorite,
}: StickerBrowserProps) {
  const stickerPackOrder = useAppPreferences((preferences) => preferences.stickerPackOrder);
  const orderedPacks = useMemo(() => getOrderedStickerPacks(stickerPackOrder), [stickerPackOrder]);
  const [query, setQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<EmojiSearchGroup>();
  const isFiltering = Boolean(query.trim()) || Boolean(selectedGroup);
  const isSearching = isSearchFocused || isFiltering;
  const [activeSection, setActiveSection] = useState(STICKER_PACKS[0].id);
  const [viewedPackId, setViewedPackId] = useState<string>();
  const gridRef = useRef<PickerGridControls>(null);
  const viewedPack = STICKER_PACKS.find((pack) => pack.id === viewedPackId);
  const viewedStickers = STICKERS.filter((sticker) => sticker.packId === viewedPackId);
  const hasFavorites = STICKERS.some((sticker) => favoriteStickers.includes(sticker.id));
  const hasRecentStickers = STICKERS.some((sticker) => recentStickers.includes(sticker.id));

  const sections = useMemo(() => {
    if (selectedGroup) {
      return [
        {
          id: selectedGroup.id,
          title: selectedGroup.label,
          items: STICKERS.filter((sticker) => matchesEmojiGroup(sticker.emoji, selectedGroup)),
        },
      ];
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      const items = STICKERS.filter((sticker) => {
        const searchableText = `${sticker.name} ${sticker.keywords} ${sticker.emoji}`.toLowerCase();
        return searchableText.includes(normalizedQuery);
      });
      return [
        {
          id: 'results',
          title: 'Search Results',
          items,
        },
      ];
    }
    const groups: PickerSection<Sticker>[] = [];
    const favorites = STICKERS.filter((sticker) => favoriteStickers.includes(sticker.id));
    const recent = recentStickers.flatMap((id) => STICKERS.filter((sticker) => sticker.id === id));
    if (favorites.length) {
      groups.push({
        id: 'favorites',
        title: 'Favorites',
        items: favorites,
      });
    }
    if (recent.length) {
      groups.push({
        id: 'recent',
        title: 'Recently Used',
        items: recent,
      });
    }
    for (const pack of orderedPacks) {
      groups.push({
        id: pack.id,
        title: pack.name,
        items: STICKERS.filter((sticker) => sticker.packId === pack.id),
      });
    }
    return groups;
  }, [query, selectedGroup, recentStickers, favoriteStickers, orderedPacks]);
  const hasResults = sections.some((section) => section.items.length > 0);

  function renderSticker(sticker: Sticker) {
    return (
      <StickerCell
        key={sticker.id}
        sticker={sticker}
        isFavorite={favoriteStickers.includes(sticker.id)}
        onSend={onSelect}
        onToggleFavorite={onToggleFavorite}
        onViewPack={setViewedPackId}
      />
    );
  }

  return (
    <div className={styles.browser} data-searching={isSearching}>
      <div className={styles.packBar} aria-label="Sticker sets">
        {hasFavorites && (
          <button
            aria-label="Favorite stickers"
            aria-pressed={activeSection === 'favorites'}
            onClick={() => gridRef.current?.scrollToSection('favorites')}
          >
            <Star size={24} />
          </button>
        )}
        {hasRecentStickers && (
          <button
            aria-label="Recent stickers"
            aria-pressed={activeSection === 'recent'}
            onClick={() => gridRef.current?.scrollToSection('recent')}
          >
            <Clock3 size={24} />
          </button>
        )}
        {orderedPacks.map((pack) => (
          <button
            key={pack.id}
            aria-label={pack.name}
            aria-pressed={activeSection === pack.id}
            onClick={() => gridRef.current?.scrollToSection(pack.id)}
          >
            <img src={pack.preview} alt="" draggable={false} />
          </button>
        ))}
      </div>
      <PickerSearch
        label="Search Stickers"
        query={query}
        selectedGroup={selectedGroup}
        onQueryChange={setQuery}
        onFocusChange={(details) => setIsSearchFocused(details.isFocused)}
        onGroupChange={setSelectedGroup}
      />
      <PickerResults viewKey={selectedGroup?.id ?? (query.trim() ? 'search' : 'packs')}>
        {hasResults ? (
          <PickerGrid
            sections={sections}
            columns={STICKER_COLUMNS}
            rowHeight={STICKER_ROW_HEIGHT}
            controlsRef={isFiltering ? undefined : gridRef}
            onSectionChange={isFiltering ? undefined : setActiveSection}
            renderItem={renderSticker}
          />
        ) : (
          <p className={styles.empty}>No stickers found</p>
        )}
      </PickerResults>
      <Dialog.Root
        open={Boolean(viewedPack)}
        onOpenChange={(details) => {
          if (!details.open) {
            setViewedPackId(undefined);
          }
        }}
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop className={styles.packBackdrop} />
          <Dialog.Positioner data-emoticon-overlay className={styles.packPositioner}>
            <Dialog.Content className={styles.packDialog}>
              <header>
                <Dialog.CloseTrigger aria-label="Close sticker set">
                  <X />
                </Dialog.CloseTrigger>
                <Dialog.Title>{viewedPack?.name}</Dialog.Title>
              </header>
              <Dialog.Description className={styles.packDescription}>
                {viewedStickers.length} stickers
                <a href={viewedPack?.url} target="_blank" rel="noreferrer">
                  View on Telegram
                </a>
              </Dialog.Description>
              <StickerPlaybackScope group="pack" isActive={Boolean(viewedPack)}>
                <div className={styles.packGrid}>{viewedStickers.map(renderSticker)}</div>
              </StickerPlaybackScope>
              <Dialog.CloseTrigger className={styles.packDone}>Done</Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
}
