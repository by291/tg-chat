import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import type { components } from '@/api/schema';
import { IconButton } from '@/components/IconButton';
import { AccountForm, Field } from '@/features/accounts/AccountForm';
import { STICKER_PACKS } from '@/features/stickers/stickerCatalog';
import { getOrderedStickerPacks } from '@/features/stickers/stickerPackOrder';
import styles from './AccountPreferencesPanel.module.css';

type AccountPreferences = components['schemas']['AccountPreferences'];
type AccountPreferenceChanges = components['schemas']['AccountPreferenceChanges'];
type NotificationDefaults = AccountPreferences['notification_defaults'];
type NotificationCategory = 'private' | 'group' | 'channel';
type MoveDirection = 'up' | 'down';

const MINIMUM_VOLUME = 0;
const MAXIMUM_VOLUME = 100;
const CATEGORIES: { key: NotificationCategory; label: string }[] = [
  { key: 'private', label: 'Private chats' },
  { key: 'group', label: 'Groups' },
  { key: 'channel', label: 'Channels' },
];

interface AccountPreferencesPanelProps {
  preferences: AccountPreferences | null;
  onUpdate: (changes: AccountPreferenceChanges) => Promise<void>;
}

interface PreferencesFormProps {
  preferences: AccountPreferences;
  onUpdate: AccountPreferencesPanelProps['onUpdate'];
}

interface DefaultCheckboxProps {
  name: string;
  label: string;
  isChecked: boolean;
}

function DefaultCheckbox({ name, label, isChecked }: DefaultCheckboxProps) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" name={name} defaultChecked={isChecked} />
      <span>{label}</span>
    </label>
  );
}

function readCategory(fields: FormData, category: NotificationCategory) {
  return {
    should_notify: fields.has(`${category}_notifications`),
    should_show_preview: fields.has(`${category}_previews`),
  };
}

function readNotificationDefaults(fields: FormData): NotificationDefaults {
  return {
    should_show_notifications: fields.has('show_notifications'),
    should_show_offline_notifications: fields.has('show_offline_notifications'),
    should_play_sound: fields.has('play_sound'),
    should_play_sent_sound: fields.has('play_sent_sound'),
    volume: Number(fields.get('volume')),
    private: readCategory(fields, 'private'),
    group: readCategory(fields, 'group'),
    channel: readCategory(fields, 'channel'),
  };
}

function NotificationDefaultsForm({ preferences, onUpdate }: PreferencesFormProps) {
  const defaults = preferences.notification_defaults;

  return (
    <section className={styles.section} aria-labelledby="connected-notification-defaults">
      <h3 id="connected-notification-defaults">Notification defaults</h3>
      <AccountForm
        submitLabel="Save notification defaults"
        onSubmit={(fields) =>
          onUpdate({
            expected_version: preferences.version,
            notification_defaults: readNotificationDefaults(fields),
          })
        }
      >
        <DefaultCheckbox
          name="show_notifications"
          label="In-app alerts"
          isChecked={defaults.should_show_notifications}
        />
        <DefaultCheckbox
          name="show_offline_notifications"
          label="Allow background alerts"
          isChecked={defaults.should_show_offline_notifications}
        />
        <p className={styles.description}>Each browser enables push separately.</p>
        <DefaultCheckbox
          name="play_sound"
          label="Notification sound"
          isChecked={defaults.should_play_sound}
        />
        <DefaultCheckbox
          name="play_sent_sound"
          label="Message sent sound"
          isChecked={defaults.should_play_sent_sound}
        />
        <Field
          label="Notification volume"
          name="volume"
          type="number"
          min={MINIMUM_VOLUME}
          max={MAXIMUM_VOLUME}
          defaultValue={defaults.volume}
          required
        />
        {CATEGORIES.map(({ key, label }) => (
          <fieldset key={key}>
            <legend>{label}</legend>
            <DefaultCheckbox
              name={`${key}_notifications`}
              label={`${label} notifications`}
              isChecked={defaults[key].should_notify}
            />
            <DefaultCheckbox
              name={`${key}_previews`}
              label={`${label} previews`}
              isChecked={defaults[key].should_show_preview}
            />
          </fieldset>
        ))}
      </AccountForm>
    </section>
  );
}

function StickerPacksForm({ preferences, onUpdate }: PreferencesFormProps) {
  const [selected, setSelected] = useState(preferences.sticker_pack_ids);
  const ordered = getOrderedStickerPacks(selected, { shouldAppendUnlisted: false });
  const unselected = STICKER_PACKS.filter((pack) => !selected.includes(pack.id));

  function movePack(packId: string, direction: MoveDirection) {
    setSelected((current) => {
      const from = current.indexOf(packId);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= current.length) {
        return current;
      }

      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, packId);
      return next;
    });
  }

  function togglePack(packId: string) {
    setSelected((current) => {
      if (current.includes(packId)) {
        return current.filter((id) => id !== packId);
      }

      return [...current, packId];
    });
  }

  return (
    <section className={styles.section} aria-labelledby="connected-sticker-packs">
      <h3 id="connected-sticker-packs">Sticker packs</h3>
      <AccountForm
        submitLabel="Save sticker packs"
        onSubmit={() =>
          onUpdate({
            expected_version: preferences.version,
            sticker_pack_ids: selected,
          })
        }
      >
        <ul className={styles.packs}>
          {[...ordered, ...unselected].map((pack, index) => {
            const isSelected = selected.includes(pack.id);

            return (
              <li key={pack.id} className={styles.pack}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => togglePack(pack.id)}
                  />
                  <img className={styles.preview} src={pack.preview} alt="" loading="lazy" />
                  <span>{pack.name}</span>
                </label>
                {isSelected && (
                  <div className={styles.reorder}>
                    <IconButton
                      label={`Move ${pack.name} up`}
                      disabled={index === 0}
                      onClick={() => movePack(pack.id, 'up')}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label={`Move ${pack.name} down`}
                      disabled={index === selected.length - 1}
                      onClick={() => movePack(pack.id, 'down')}
                    >
                      <ArrowDown />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </AccountForm>
    </section>
  );
}

/** Edit server-owned notification defaults and bundled sticker choices for the current account. */
export function AccountPreferencesPanel({ preferences, onUpdate }: AccountPreferencesPanelProps) {
  if (!preferences) {
    return <p role="status">Loading account preferences…</p>;
  }

  return (
    <div className={styles.panel} key={preferences.version}>
      <NotificationDefaultsForm preferences={preferences} onUpdate={onUpdate} />
      <StickerPacksForm preferences={preferences} onUpdate={onUpdate} />
    </div>
  );
}
