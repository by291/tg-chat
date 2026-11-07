import { Popover } from '@ark-ui/react/popover';
import { Portal } from '@ark-ui/react/portal';
import { Tabs } from '@ark-ui/react/tabs';
import { Delete, Smile, Sticker as StickerIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { EmojiBrowser } from './emoticons/EmojiBrowser';
import { StickerBrowser } from './emoticons/StickerBrowser';
import { usePickerPreferences } from './emoticons/pickerPreferences';
import type { Sticker } from '../stickers/stickerCatalog';
import styles from './EmojiPicker.module.css';

const HOVER_OPEN_DELAY = 200;
const HOVER_CLOSE_DELAY = 200;

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker?: (sticker: string) => void;
  onDeleteCharacter?: () => void;
}

/** Anchor a Telegram-style palette while keeping drafts and selection owned by the editor. */
export function EmojiPicker({
  onSelectEmoji,
  onSelectSticker,
  onDeleteCharacter,
}: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState('emoji');
  const activeTab = onSelectSticker ? tab : 'emoji';
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isClickOpenedRef = useRef(false);
  const { preferences, rememberEmoji, setTone, rememberSticker, toggleFavorite } =
    usePickerPreferences();

  function cancelHoverTimer() {
    clearTimeout(hoverTimerRef.current);
  }

  useEffect(() => cancelHoverTimer, []);

  function sendSticker(sticker: Sticker) {
    rememberSticker(sticker.id);
    onSelectSticker?.(sticker.id);
    setIsOpen(false);
    isClickOpenedRef.current = false;
  }

  function scheduleHoverClose() {
    cancelHoverTimer();
    if (!isClickOpenedRef.current) {
      hoverTimerRef.current = setTimeout(() => setIsOpen(false), HOVER_CLOSE_DELAY);
    }
  }

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(details) => {
        cancelHoverTimer();
        setIsOpen(details.open);
        if (!details.open) {
          isClickOpenedRef.current = false;
        }
      }}
      autoFocus={false}
      positioning={{
        placement: 'top-end',
        gutter: 8,
        overflowPadding: 8,
        getAnchorRect: () => {
          const composer = triggerRef.current?.closest('[data-message-composer]');
          return (
            composer?.getBoundingClientRect() ?? triggerRef.current?.getBoundingClientRect() ?? null
          );
        },
      }}
      lazyMount
      unmountOnExit
    >
      <Popover.Anchor asChild>
        <IconButton
          ref={triggerRef}
          label="Emoji and stickers"
          data-open={isOpen}
          className={styles.trigger}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => {
            cancelHoverTimer();
            // A click pins a hover-opened panel; only a second click closes it.
            isClickOpenedRef.current = !isClickOpenedRef.current;
            setIsOpen(isClickOpenedRef.current);
          }}
          onPointerEnter={(event) => {
            cancelHoverTimer();
            if (event.pointerType === 'mouse') {
              hoverTimerRef.current = setTimeout(() => setIsOpen(true), HOVER_OPEN_DELAY);
            }
          }}
          onPointerLeave={scheduleHoverClose}
        >
          <Smile />
        </IconButton>
      </Popover.Anchor>
      <Portal>
        <Popover.Positioner className={styles.positioner}>
          <Popover.Content
            className={styles.panel}
            aria-label="Emoji and stickers"
            onPointerEnter={cancelHoverTimer}
            onFocusCapture={() => {
              isClickOpenedRef.current = true;
            }}
            onContextMenuCapture={() => {
              isClickOpenedRef.current = true;
            }}
            onPointerLeave={(event) => {
              const nextTarget = event.relatedTarget;
              const isPickerOverlay =
                nextTarget instanceof Element &&
                Boolean(nextTarget.closest('[data-emoticon-overlay]'));
              if (isPickerOverlay || event.buttons > 0) {
                return;
              }
              scheduleHoverClose();
            }}
            onPointerDownCapture={(event) => {
              if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) {
                return;
              }

              // Preserve the editor selection, but let clicks outside the search input blur it.
              // Blocking every pointerdown traps search focus and prevents Telegram's collapse.
              const focusedElement = event.currentTarget.ownerDocument.activeElement;
              const isSearchFocused = focusedElement?.matches('[data-picker-search-input]');
              const isInputTarget = Boolean(event.target.closest('input'));
              if (!isSearchFocused && !isInputTarget) {
                event.preventDefault();
              }
            }}
          >
            <Tabs.Root
              value={activeTab}
              onValueChange={(details) => setTab(details.value)}
              className={styles.tabRoot}
              lazyMount
            >
              <Tabs.Content value="emoji" className={styles.tabContent}>
                <EmojiBrowser
                  recentEmoji={preferences.recentEmoji}
                  tones={preferences.tones}
                  onSelect={(emoji) => {
                    const tone = preferences.tones[emoji.id] ?? 0;
                    onSelectEmoji((emoji.skins[tone] ?? emoji.skins[0]).native);
                    rememberEmoji(emoji.id);
                  }}
                  onToneChange={setTone}
                />
              </Tabs.Content>
              {onSelectSticker && (
                <Tabs.Content value="stickers" className={styles.tabContent}>
                  <StickerBrowser
                    recentStickers={preferences.recentStickers}
                    favoriteStickers={preferences.favoriteStickers}
                    onSelect={sendSticker}
                    onToggleFavorite={toggleFavorite}
                  />
                </Tabs.Content>
              )}
              <Tabs.List className={styles.tabs}>
                <Tabs.Trigger value="emoji" aria-label="Emoji">
                  <Smile size={24} />
                </Tabs.Trigger>
                {onSelectSticker && (
                  <Tabs.Trigger value="stickers" aria-label="Stickers">
                    <StickerIcon size={24} />
                  </Tabs.Trigger>
                )}
                {onDeleteCharacter && activeTab === 'emoji' && (
                  <button
                    className={styles.delete}
                    aria-label="Delete last character"
                    onClick={onDeleteCharacter}
                  >
                    <Delete size={22} />
                  </button>
                )}
              </Tabs.List>
            </Tabs.Root>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
