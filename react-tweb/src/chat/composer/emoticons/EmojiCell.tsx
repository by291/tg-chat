import { Popover } from '@ark-ui/react/popover';
import { Portal } from '@ark-ui/react/portal';
import type { Emoji } from '@emoji-mart/data';
import { useEffect, useRef, useState } from 'react';
import styles from '../EmojiPicker.module.css';

const TONE_HOLD_DELAY = 400;
// prettier-ignore
const SKIN_TONE_NAMES = [
  'Default',
  'Light',
  'Medium-light',
  'Medium',
  'Medium-dark',
  'Dark',
];

interface EmojiCellProps {
  emoji: Emoji;
  tone: number;
  onSelect: (emoji: Emoji) => void;
  onToneChange: (id: string, tone: number) => void;
}

/** Keep tone selection separate from insertion, matching Telegram's per-emoji preference. */
export function EmojiCell({ emoji, tone, onSelect, onToneChange }: EmojiCellProps) {
  const [isToneOpen, setIsToneOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const didHoldRef = useRef(false);
  const hasTones = emoji.skins.length > 1;
  const skin = emoji.skins[tone] ?? emoji.skins[0];

  function cancelHold() {
    clearTimeout(timerRef.current);
  }

  useEffect(() => cancelHold, []);

  return (
    <Popover.Root
      open={isToneOpen}
      onOpenChange={(details) => setIsToneOpen(details.open)}
      positioning={{ placement: 'top', gutter: 6 }}
      autoFocus={false}
      lazyMount
      unmountOnExit
    >
      <Popover.Anchor asChild>
        <button
          className={styles.emojiCell}
          aria-label={emoji.name}
          aria-haspopup={hasTones ? 'dialog' : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            if (hasTones) {
              setIsToneOpen(true);
            }
          }}
          onPointerDown={(event) => {
            didHoldRef.current = false;
            if (event.button !== 0 || !hasTones) {
              return;
            }
            timerRef.current = setTimeout(() => {
              didHoldRef.current = true;
              setIsToneOpen(true);
            }, TONE_HOLD_DELAY);
          }}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onPointerLeave={cancelHold}
          onClick={() => {
            if (!didHoldRef.current) {
              onSelect(emoji);
            }
          }}
        >
          {skin.native}
        </button>
      </Popover.Anchor>
      <Portal>
        <Popover.Positioner data-emoticon-overlay className={styles.tonePositioner}>
          <Popover.Content className={styles.tones} aria-label={`Skin tone for ${emoji.name}`}>
            {emoji.skins.map((variant, index) => (
              <button
                key={variant.unified}
                aria-label={`${SKIN_TONE_NAMES[index]} skin tone`}
                aria-pressed={index === tone}
                onClick={() => {
                  onToneChange(emoji.id, index);
                  setIsToneOpen(false);
                }}
              >
                {variant.native}
              </button>
            ))}
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
