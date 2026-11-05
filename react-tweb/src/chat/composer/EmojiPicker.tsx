import { Popover } from '@ark-ui/react/popover';
import { Portal } from '@ark-ui/react/portal';
import { Tabs } from '@ark-ui/react/tabs';
import { Search, Smile } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../../components/IconButton';
import styles from './EmojiPicker.module.css';
import overlays from '../overlays.module.css';

const EMOJI = [
  { symbol: '😀', name: 'grinning smile happy' },
  { symbol: '😄', name: 'smiling happy' },
  { symbol: '😁', name: 'beaming smile' },
  { symbol: '😂', name: 'laugh tears joy' },
  { symbol: '🥰', name: 'love hearts' },
  { symbol: '😍', name: 'heart eyes love' },
  { symbol: '😎', name: 'cool sunglasses' },
  { symbol: '🥳', name: 'party celebration' },
  { symbol: '🤔', name: 'thinking' },
  { symbol: '🫡', name: 'salute' },
  { symbol: '🥹', name: 'happy tears' },
  { symbol: '😴', name: 'sleep tired' },
  { symbol: '👋', name: 'wave hello' },
  { symbol: '👍', name: 'thumbs up like' },
  { symbol: '👏', name: 'clap applause' },
  { symbol: '🙌', name: 'raised hands celebration' },
  { symbol: '❤️', name: 'red heart love' },
  { symbol: '💜', name: 'purple heart love' },
  { symbol: '🔥', name: 'fire hot' },
  { symbol: '✨', name: 'sparkles' },
  { symbol: '🎉', name: 'party popper celebration' },
  { symbol: '💯', name: 'hundred perfect' },
  { symbol: '🚀', name: 'rocket launch' },
  { symbol: '💻', name: 'computer coding laptop' },
  { symbol: '🌿', name: 'leaf nature' },
  { symbol: '🌸', name: 'flower blossom' },
  { symbol: '☀️', name: 'sun sunny' },
  { symbol: '🌈', name: 'rainbow' },
  { symbol: '☕', name: 'coffee cup' },
  { symbol: '🍕', name: 'pizza food' },
  { symbol: '🐱', name: 'cat' },
  { symbol: '🐻', name: 'bear' },
];

// prettier-ignore
const STICKERS = [
  '👋',
  '🥰',
  '🐻',
  '🎉',
  '🔥',
  '💜',
];

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker: (sticker: string) => void;
}

/** Offer a local searchable emoji palette and large emoji stickers. */
export function EmojiPicker({ onSelectEmoji, onSelectSticker }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matchingEmoji = EMOJI.filter((emoji) => emoji.name.includes(query.trim().toLowerCase()));

  function sendSticker(sticker: string) {
    onSelectSticker(sticker);
    setIsOpen(false);
  }

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(details) => setIsOpen(details.open)}
      positioning={{ placement: 'top-end', gutter: 12 }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <IconButton label="Emoji and stickers">
          <Smile />
        </IconButton>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content className={overlays.popover}>
            <Tabs.Root defaultValue="emoji">
              <Tabs.Content value="emoji">
                <Popover.Title className={styles.title}>Emoji</Popover.Title>
                <label className={styles.search}>
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search emoji"
                    aria-label="Search emoji"
                  />
                </label>
                <div className={styles.emojiGrid}>
                  {matchingEmoji.map((emoji) => (
                    <button
                      key={emoji.symbol}
                      aria-label={emoji.name}
                      onClick={() => onSelectEmoji(emoji.symbol)}
                    >
                      {emoji.symbol}
                    </button>
                  ))}
                </div>
                {matchingEmoji.length === 0 && <p className={styles.empty}>No emoji found</p>}
              </Tabs.Content>
              <Tabs.Content value="stickers">
                <Popover.Title className={styles.title}>Everyday expressions</Popover.Title>
                <div className={styles.stickerGrid}>
                  {STICKERS.map((sticker) => (
                    <button
                      key={sticker}
                      aria-label={`Send ${sticker} sticker`}
                      onClick={() => sendSticker(sticker)}
                    >
                      {sticker}
                    </button>
                  ))}
                </div>
              </Tabs.Content>
              <Tabs.List className={styles.tabs}>
                <Tabs.Trigger value="emoji">Emoji</Tabs.Trigger>
                <Tabs.Trigger value="stickers">Stickers</Tabs.Trigger>
                <Tabs.Indicator className={styles.indicator} />
              </Tabs.List>
            </Tabs.Root>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
