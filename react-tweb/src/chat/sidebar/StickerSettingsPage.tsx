import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { Repeat, Smile, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { setAppPreferences, useAppPreferences } from '../../app/settings/appPreferences';
import { Ripple } from '../../components/Ripple';
import { CUSTOM_EMOJI_PACKS } from '../emoji/customEmojiCatalog';
import { STICKERS, STICKER_PACKS } from '../stickers/stickerCatalog';
import { StickerArtwork } from '../stickers/StickerArtwork';
import { StickerPlaybackScope } from '../stickers/StickerPlaybackScope';
import {
  getStickerPlaybackState,
  setStickerLoopPreference,
  subscribeStickerPlayback,
} from '../stickers/stickerPlayback';
import { SettingsHeader, SettingsSwitch } from './SettingsControls';
import { useClosingDialogValue } from './useClosingDialogValue';
import settings from './SettingsPage.module.css';
import styles from './StickerSettingsPage.module.css';
import pickerStyles from '../composer/EmojiPicker.module.css';

const INSTALLED_PACKS = [
  ...STICKER_PACKS.map((pack) => ({
    ...pack,
    kind: 'stickers',
    items: STICKERS.filter((sticker) => sticker.packId === pack.id),
  })),
  ...CUSTOM_EMOJI_PACKS.map((pack) => ({
    ...pack,
    kind: 'emoji',
    preview: pack.emojis[0]?.preview,
    items: pack.emojis,
  })),
];

/** Apply playback preferences and browse the same installed packs used by the composer. */
export function StickerSettingsPage({ onBack }: { onBack: () => void }) {
  const preferences = useAppPreferences();
  const { shouldLoop } = useSyncExternalStore(subscribeStickerPlayback, getStickerPlaybackState);
  const [selectedPackId, setSelectedPackId] = useState<string>();
  const selectedPack = INSTALLED_PACKS.find((pack) => pack.id === selectedPackId);
  const closingPack = useClosingDialogValue(selectedPack);

  function renderPackSection(kind: string, title: string) {
    const packs = INSTALLED_PACKS.filter((pack) => pack.kind === kind);
    return (
      <section className={settings.section} aria-label={title}>
        <h3>{title}</h3>
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={settings.row}
            onClick={() => setSelectedPackId(pack.id)}
          >
            <img className={styles.packImage} src={pack.preview} alt="" loading="lazy" />
            <span className={settings.label}>
              {pack.name}
              <span className={styles.packCount}>
                {pack.items.length} {pack.kind}
              </span>
            </span>
            <Ripple />
          </button>
        ))}
      </section>
    );
  }

  return (
    <section className={settings.page} aria-label="Stickers and Emoji settings">
      <SettingsHeader
        title="Stickers and Emoji"
        backLabel="Back from sticker settings"
        onBack={onBack}
      />
      <div className={settings.scrollContent}>
        <div className={settings.section}>
          <SettingsSwitch
            label="Loop Animated Stickers"
            icon={Repeat}
            color="pink"
            isChecked={shouldLoop}
            onChange={({ isChecked }) => setStickerLoopPreference({ shouldLoop: isChecked })}
          />
        </div>
        <p className={settings.caption}>Animated stickers will play continuously in chats.</p>
        <section className={settings.section} aria-label="Emoji appearance">
          <h3>Emoji</h3>
          <SettingsSwitch
            label="Large Emoji"
            icon={Smile}
            color="orange"
            isChecked={preferences.shouldUseLargeEmoji}
            onChange={({ isChecked }) => setAppPreferences({ shouldUseLargeEmoji: isChecked })}
          />
        </section>
        {renderPackSection('stickers', 'Stickers')}
        {renderPackSection('emoji', 'Emoji')}
      </div>
      <Dialog.Root
        open={Boolean(selectedPack)}
        onOpenChange={({ open }) => {
          if (!open) {
            setSelectedPackId(undefined);
          }
        }}
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop className={pickerStyles.packBackdrop} />
          <Dialog.Positioner className={pickerStyles.packPositioner}>
            <Dialog.Content className={pickerStyles.packDialog}>
              <header>
                <Dialog.CloseTrigger aria-label="Close set preview">
                  <X />
                </Dialog.CloseTrigger>
                <Dialog.Title>{closingPack?.name}</Dialog.Title>
              </header>
              <Dialog.Description className={pickerStyles.packDescription}>
                {closingPack?.items.length} {closingPack?.kind}
                <a href={closingPack?.url} target="_blank" rel="noreferrer">
                  View on Telegram
                </a>
              </Dialog.Description>
              <StickerPlaybackScope group="pack">
                <div className={styles.previewGrid}>
                  {closingPack?.items.map((item) => (
                    <div key={item.id} className={styles.previewItem}>
                      <StickerArtwork sticker={item} />
                    </div>
                  ))}
                </div>
              </StickerPlaybackScope>
              <Dialog.CloseTrigger className={pickerStyles.packDone}>Done</Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </section>
  );
}
