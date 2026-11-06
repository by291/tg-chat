import { Switch } from '@ark-ui/react/switch';
import { ArrowLeft, Repeat } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import {
  getStickerPlaybackState,
  setStickerLoopPreference,
  subscribeStickerPlayback,
} from '../stickers/stickerPlayback';
import styles from './StickerSettingsPage.module.css';

/** Apply Telegram's looping preference immediately without remounting sticker players. */
export function StickerSettingsPage({ onBack }: { onBack: () => void }) {
  const { shouldLoop } = useSyncExternalStore(subscribeStickerPlayback, getStickerPlaybackState);

  return (
    <section className={styles.page} aria-label="Stickers and Emoji settings">
      <header className={styles.header}>
        <IconButton label="Back from sticker settings" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <h2>Stickers and Emoji</h2>
      </header>
      <div className={styles.content}>
        <Switch.Root
          className={styles.switchRow}
          checked={shouldLoop}
          onCheckedChange={({ checked }) => {
            setStickerLoopPreference({ shouldLoop: checked });
          }}
        >
          <Repeat className={styles.icon} aria-hidden="true" />
          <Switch.Label>Loop Animated Stickers</Switch.Label>
          <Switch.Control className={styles.switchControl}>
            <Switch.Thumb className={styles.switchThumb} />
          </Switch.Control>
          <Switch.HiddenInput />
          <Ripple />
        </Switch.Root>
        <p>Animated stickers will play continuously in chats.</p>
      </div>
    </section>
  );
}
