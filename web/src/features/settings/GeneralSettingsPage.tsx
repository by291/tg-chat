import { useAppNavigation } from '@/routes/useAppNavigation';
import { Palette, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  MAX_MESSAGE_TEXT_SIZE,
  MIN_MESSAGE_TEXT_SIZE,
  setAppPreferences,
  useAppPreferences,
} from './appPreferences';
import { formatMessageTime } from '@/features/chat/messageFormatting';
import {
  SettingsHeader,
  SettingsRange,
  SettingsRadio,
  SettingsRow,
  SettingsSwitch,
} from './SettingsControls';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import { ThemeSettings } from './appearance/ThemeSettings';
import { WallpaperSettingsPage } from './appearance/WallpaperSettingsPage';
import { useClosingDialogValue } from '@/hooks/useClosingDialogValue';
import styles from './SettingsPage.module.css';

const MINUTE_DURATION = 60_000;

interface GeneralSettingsPageProps {
  onBack: () => void;
}

/** Edit message presentation and open the media power-saving preferences. */
export function GeneralSettingsPage({ onBack }: GeneralSettingsPageProps) {
  const preferences = useAppPreferences();
  const navigation = useAppNavigation();
  const closingPage = useClosingDialogValue(navigation.settingsPage);
  const isGeneralDestination = navigation.settingsDestination?.category === 'general';
  // A parent exit keeps the outgoing nested surface intact until it returns to General Settings.
  const page = isGeneralDestination ? navigation.settingsPage : closingPage;
  const [previewTimestamp, setPreviewTimestamp] = useState(Date.now);
  const isPowerSaving =
    !preferences.shouldAutoplayVideos ||
    !preferences.shouldAnimateStickers ||
    !preferences.shouldAutoplayStickersInChat ||
    !preferences.shouldAutoplayStickersInPanel;

  useEffect(() => {
    const interval = window.setInterval(() => setPreviewTimestamp(Date.now()), MINUTE_DURATION);
    return () => window.clearInterval(interval);
  }, []);

  const generalPage = (
    <section className={styles.page} aria-label="General Settings">
      <SettingsHeader
        title="General Settings"
        backLabel="Back from general settings"
        onBack={onBack}
      />
      <div className={styles.scrollContent}>
        <section className={styles.section} aria-label="Message appearance">
          <h3>Settings</h3>
          <SettingsRange
            label="Message Text Size"
            value={preferences.messageTextSize}
            minimum={MIN_MESSAGE_TEXT_SIZE}
            maximum={MAX_MESSAGE_TEXT_SIZE}
            onChange={(messageTextSize) => setAppPreferences({ messageTextSize })}
          />
          <SettingsRow
            label="Chat Wallpaper"
            icon={Palette}
            color="orange"
            onClick={() => navigation.openSettingsPage('wallpaper')}
          />
          <SettingsRow
            label="Power Saving Mode"
            icon={Rocket}
            color="purple"
            value={isPowerSaving ? 'Enabled' : 'Disabled'}
            onClick={() => navigation.openSettingsPage('power')}
          />
        </section>
        <ThemeSettings />
        <fieldset className={`${styles.section} ${styles.radioSection}`}>
          <legend>Time Format</legend>
          <SettingsRadio
            label="12-hour"
            description={formatMessageTime(previewTimestamp, { timeFormat: 'h12' })}
            name="time-format"
            value="h12"
            isChecked={preferences.timeFormat === 'h12'}
            onChange={() => setAppPreferences({ timeFormat: 'h12' })}
          />
          <SettingsRadio
            label="24-hour"
            description={formatMessageTime(previewTimestamp, { timeFormat: 'h23' })}
            name="time-format"
            value="h23"
            isChecked={preferences.timeFormat === 'h23'}
            onChange={() => setAppPreferences({ timeFormat: 'h23' })}
          />
        </fieldset>
      </div>
    </section>
  );

  return (
    <div
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && page && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          navigation.openSettingsPage(undefined);
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={Boolean(page)}
        primary={generalPage}
        secondary={
          closingPage === 'wallpaper' ? (
            <WallpaperSettingsPage onBack={() => navigation.openSettingsPage(undefined)} />
          ) : (
            <PowerSavingPage onBack={() => navigation.openSettingsPage(undefined)} />
          )
        }
      />
    </div>
  );
}

function PowerSavingPage({ onBack }: { onBack: () => void }) {
  const preferences = useAppPreferences();
  return (
    <section className={styles.page} aria-label="Power Saving Mode">
      <SettingsHeader title="Power Saving" backLabel="Back from power saving" onBack={onBack} />
      <div className={styles.scrollContent}>
        <div className={styles.section}>
          <SettingsSwitch
            label="Autoplay Videos"
            isChecked={preferences.shouldAutoplayVideos}
            onChange={({ isChecked }) => setAppPreferences({ shouldAutoplayVideos: isChecked })}
          />
          <SettingsSwitch
            label="Animated Stickers and Emoji"
            isChecked={preferences.shouldAnimateStickers}
            onChange={({ isChecked }) => setAppPreferences({ shouldAnimateStickers: isChecked })}
          />
          {preferences.shouldAnimateStickers && (
            <div className={styles.nestedControls}>
              <SettingsSwitch
                label="Autoplay in Chat"
                isChecked={preferences.shouldAutoplayStickersInChat}
                onChange={({ isChecked }) =>
                  setAppPreferences({ shouldAutoplayStickersInChat: isChecked })
                }
              />
              <SettingsSwitch
                label="Autoplay in Panel"
                isChecked={preferences.shouldAutoplayStickersInPanel}
                onChange={({ isChecked }) =>
                  setAppPreferences({ shouldAutoplayStickersInPanel: isChecked })
                }
              />
            </div>
          )}
        </div>
        <p className={styles.caption}>
          Disable automatic playback to reduce power usage. You can still open and play videos. Your
          device’s reduced motion preference also limits automatic playback.
        </p>
      </div>
    </section>
  );
}
