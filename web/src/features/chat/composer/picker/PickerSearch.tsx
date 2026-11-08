import { ArrowLeft, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { StickerArtwork } from '@/features/stickers/StickerArtwork';
import {
  EMOJI_SEARCH_GROUPS,
  getSearchCategoryIcon,
  type EmojiSearchGroup,
} from './emojiSearchGroups';
import { useFilterScroll } from './useFilterScroll';
import styles from './EmojiPicker.module.css';

const DRAG_THRESHOLD = 4;
const VERTICAL_WHEEL_DIVISOR = 4;

interface FilterDrag {
  startX: number;
  scrollLeft: number;
}

interface PickerSearchProps {
  label: string;
  query: string;
  selectedGroup: EmojiSearchGroup | undefined;
  onQueryChange: (query: string) => void;
  onFocusChange: (details: { isFocused: boolean }) => void;
  onGroupChange: (group: EmojiSearchGroup | undefined) => void;
}

/** Keep text input and horizontally scrollable emotion filters in the same search field. */
export function PickerSearch({
  label,
  query,
  selectedGroup,
  onQueryChange,
  onFocusChange,
  onGroupChange,
}: PickerSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<FilterDrag | undefined>(undefined);
  const didDragRef = useRef(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const hasQuery = Boolean(query.trim());
  const { scrollToOffset, cancelScroll } = useFilterScroll(filtersRef);

  useEffect(() => {
    const container = filtersRef.current;
    if (!container) {
      return;
    }

    function scrollFilters(event: WheelEvent) {
      cancelScroll();
      event.stopPropagation();
      if (!container || event.deltaX || container.scrollWidth <= container.clientWidth) {
        return;
      }
      // Match Telegram's mouse-wheel conversion without replacing native trackpad scrolling.
      event.preventDefault();
      container.scrollLeft += event.deltaY / VERTICAL_WHEEL_DIVISOR;
    }

    container.addEventListener('wheel', scrollFilters, { passive: false });

    return () => container.removeEventListener('wheel', scrollFilters);
  }, []);

  function selectGroup(group: EmojiSearchGroup, button: HTMLButtonElement) {
    onGroupChange(group);
    const container = filtersRef.current;
    if (!container) {
      return;
    }

    const buttonBounds = button.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();
    const centerOffset = (container.clientWidth - buttonBounds.width) / 2;
    scrollToOffset(container.scrollLeft + buttonBounds.left - containerBounds.left - centerOffset);
  }

  function clearGroup() {
    onGroupChange(undefined);
    scrollToOffset(0);
  }

  return (
    <div className={styles.searchRow}>
      <div className={styles.search}>
        <Search className={styles.searchIcon} data-hidden={Boolean(selectedGroup)} size={20} />
        <button
          className={styles.searchBack}
          data-hidden={!selectedGroup}
          aria-hidden={!selectedGroup}
          tabIndex={selectedGroup ? 0 : -1}
          aria-label="Clear category"
          onClick={clearGroup}
        >
          <ArrowLeft size={22} />
        </button>
        <input
          ref={inputRef}
          data-picker-search-input
          value={query}
          aria-label={label}
          onFocus={() => onFocusChange({ isFocused: true })}
          onBlur={() => onFocusChange({ isFocused: false })}
          onChange={(event) => {
            const nextQuery = event.target.value;
            if (nextQuery.trim() && selectedGroup) {
              clearGroup();
            }
            onQueryChange(nextQuery);
          }}
        />
        <div
          ref={filtersRef}
          className={styles.searchFilters}
          data-hidden={hasQuery}
          data-scrolled={isScrolled}
          aria-hidden={hasQuery}
          inert={hasQuery}
          onScroll={(event) => setIsScrolled(event.currentTarget.scrollLeft > 0)}
          onPointerDown={(event) => {
            cancelScroll();
            didDragRef.current = false;
            if (event.pointerType !== 'mouse' || event.button !== 0) {
              return;
            }

            dragRef.current = {
              startX: event.clientX,
              scrollLeft: event.currentTarget.scrollLeft,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || event.buttons !== 1) {
              return;
            }

            const distance = event.clientX - drag.startX;
            if (Math.abs(distance) < DRAG_THRESHOLD && !didDragRef.current) {
              return;
            }

            didDragRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.scrollLeft = drag.scrollLeft - distance;
          }}
          onPointerUp={() => {
            dragRef.current = undefined;
          }}
          onPointerCancel={() => {
            dragRef.current = undefined;
          }}
          onClickCapture={(event) => {
            // Releasing a drag must not select the category under the pointer.
            if (didDragRef.current) {
              event.preventDefault();
              event.stopPropagation();
              didDragRef.current = false;
            }
          }}
        >
          <span className={styles.searchPlaceholder} onClick={() => inputRef.current?.focus()}>
            {label}
          </span>
          <div className={styles.searchCategories} role="group" aria-label="Emotion filters">
            {EMOJI_SEARCH_GROUPS.map((group) => {
              const icon = getSearchCategoryIcon(group);

              return (
                <button
                  key={group.id}
                  aria-label={group.label}
                  aria-pressed={selectedGroup?.id === group.id}
                  onClick={(event) => selectGroup(group, event.currentTarget)}
                >
                  <span className={styles.categoryIcon}>
                    {icon && <StickerArtwork sticker={icon} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {hasQuery && (
          <button
            className={styles.searchClear}
            onPointerDown={(event) => event.preventDefault()}
            aria-label="Clear search"
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
