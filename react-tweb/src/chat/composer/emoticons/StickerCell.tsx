import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Smile, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { StickerArtwork } from '../../stickers/StickerArtwork';
import { StickerPlaybackScope } from '../../stickers/StickerPlaybackScope';
import { findSticker, type Sticker } from '../../stickers/stickerCatalog';
import overlays from '../../overlays.module.css';
import styles from '../EmojiPicker.module.css';

const PREVIEW_HOLD_DELAY = 350;
const DRAG_CANCEL_DISTANCE = 8;

interface StickerCellProps {
  sticker: Sticker;
  isFavorite: boolean;
  onSend: (sticker: Sticker) => void;
  onToggleFavorite: (id: string) => void;
  onViewPack: (id: string) => void;
}

/** Distinguish a click from a held preview so releasing a preview never sends a sticker. */
export function StickerCell({
  sticker,
  isFavorite,
  onSend,
  onToggleFavorite,
  onViewPack,
}: StickerCellProps) {
  const [previewSticker, setPreviewSticker] = useState<Sticker>();
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number }>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shouldSuppressClickRef = useRef(false);
  const pointerOriginRef = useRef({ clientX: 0, clientY: 0 });

  function endPreview() {
    clearTimeout(timerRef.current);
    setPreviewSticker(undefined);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <Menu.Root
        open={Boolean(menuPoint)}
        onOpenChange={(details) => {
          if (!details.open) {
            setMenuPoint(undefined);
          }
        }}
        positioning={{
          placement: 'bottom-start',
          gutter: 0,
          getAnchorRect: () => {
            if (!menuPoint) {
              return null;
            }
            return {
              ...menuPoint,
              width: 0,
              height: 0,
            };
          },
        }}
        onSelect={({ value }) => {
          if (value === 'favorite') {
            onToggleFavorite(sticker.id);
          }
          if (value === 'pack') {
            onViewPack(sticker.packId);
          }
        }}
        lazyMount
        unmountOnExit
      >
        <button
          className={styles.stickerCell}
          data-sticker-id={sticker.id}
          aria-label={`Send ${sticker.name} sticker`}
          onContextMenu={(event) => {
            event.preventDefault();
            // A touch hold belongs to preview, not Ark's default long-press context menu.
            if (!shouldSuppressClickRef.current) {
              setMenuPoint({ x: event.clientX, y: event.clientY });
            }
          }}
          onKeyDown={(event) => {
            const isContextShortcut =
              event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
            if (isContextShortcut) {
              event.preventDefault();
              const rectangle = event.currentTarget.getBoundingClientRect();
              setMenuPoint({ x: rectangle.left, y: rectangle.bottom });
            }
          }}
          onPointerDown={(event) => {
            shouldSuppressClickRef.current = false;
            if (event.button !== 0) {
              return;
            }
            pointerOriginRef.current = { clientX: event.clientX, clientY: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            timerRef.current = setTimeout(() => {
              shouldSuppressClickRef.current = true;
              setPreviewSticker(sticker);
            }, PREVIEW_HOLD_DELAY);
          }}
          onPointerMove={(event) => {
            if (previewSticker) {
              const hoveredCell = document.elementFromPoint(event.clientX, event.clientY);
              const stickerId = hoveredCell
                ?.closest('[data-sticker-id]')
                ?.getAttribute('data-sticker-id');
              const hoveredSticker = stickerId ? findSticker(stickerId) : undefined;
              if (hoveredSticker) {
                setPreviewSticker(hoveredSticker);
              }
              return;
            }
            const distance = Math.hypot(
              event.clientX - pointerOriginRef.current.clientX,
              event.clientY - pointerOriginRef.current.clientY,
            );
            if (event.buttons > 0 && distance > DRAG_CANCEL_DISTANCE) {
              clearTimeout(timerRef.current);
              shouldSuppressClickRef.current = true;
            }
          }}
          onPointerUp={endPreview}
          onPointerCancel={endPreview}
          onLostPointerCapture={endPreview}
          onClick={() => {
            if (!shouldSuppressClickRef.current) {
              onSend(sticker);
            }
          }}
        >
          <StickerArtwork sticker={sticker} />
        </button>
        <Portal>
          <Menu.Positioner data-emoticon-overlay className={styles.contextPositioner}>
            <Menu.Content className={overlays.menu} aria-label="Sticker actions">
              <Menu.Item value="pack" className={overlays.menuItem}>
                <Smile /> View Sticker Set
              </Menu.Item>
              <Menu.Item value="favorite" className={overlays.menuItem}>
                <Star /> {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
      {previewSticker && (
        <Portal>
          <StickerPlaybackScope group="preview">
            <div
              className={styles.preview}
              role="status"
              aria-label={`Preview ${previewSticker.name}`}
            >
              <span className={styles.previewEmoji}>{previewSticker.emoji}</span>
              <div className={styles.previewArtwork}>
                <StickerArtwork key={previewSticker.id} sticker={previewSticker} />
              </div>
            </div>
          </StickerPlaybackScope>
        </Portal>
      )}
    </>
  );
}
