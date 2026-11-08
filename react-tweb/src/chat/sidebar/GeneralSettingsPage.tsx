import { Moon, Rocket } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ThemeOrigin } from '../../app/useThemeTransition';
import {
  MAX_MESSAGE_TEXT_SIZE,
  MIN_MESSAGE_TEXT_SIZE,
  setAppPreferences,
  useAppPreferences,
} from '../../app/settings/appPreferences';
import { formatMessageTime } from '../messageFormatting';
import {
  SettingsHeader,
  SettingsRange,
  SettingsRadio,
  SettingsRow,
  SettingsSwitch,
} from './SettingsControls';
import { SidebarNavigation } from './SidebarNavigation';
import styles from './SettingsPage.module.css';

const MINUTE_DURATION = 60_000;

interface GeneralSettingsPageProps {
  isDark: boolean;
  onToggleTheme: (origin?: ThemeOrigin) => void;
  onBack: () => void;
}

/** Edit message presentation and open the media power-saving preferences. */
export function GeneralSettingsPage({ isDark, onToggleTheme, onBack }: GeneralSettingsPageProps) {
  const preferences = useAppPreferences();
  const [isPowerSavingOpen, setIsPowerSavingOpen] = useState(false);
  const [previewTimestamp, setPreviewTimestamp] = useState(Date.now);
  const appearanceRef = useRef<HTMLDivElement>(null);
  const isPowerSaving = !preferences.shouldAutoplayVideos || !preferences.shouldAnimateStickers;

  useEffect(() => {
    const interval = window.setInterval(() => setPreviewTimestamp(Date.now()), MINUTE_DURATION);
    return () => window.clearInterval(interval);
  }, []);

  function changeTheme({ isChecked }: { isChecked: boolean }) {
    if (isChecked === isDark) {
      return;
    }
    const icon = appearanceRef.current?.querySelector('svg');
    const bounds = icon?.getBoundingClientRect();
    const origin = bounds
      ? { left: bounds.left + bounds.width / 2, top: bounds.top + bounds.height / 2 }
      : undefined;
    onToggleTheme(origin);
  }

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
            label="Power Saving Mode"
            icon={Rocket}
            color="purple"
            value={isPowerSaving ? 'Enabled' : 'Disabled'}
            onClick={() => setIsPowerSavingOpen(true)}
          />
        </section>
        <div ref={appearanceRef} className={styles.section}>
          <h3>Appearance</h3>
          <SettingsSwitch
            label="Dark Mode"
            icon={Moon}
            color="purple"
            isChecked={isDark}
            onChange={changeTheme}
          />
        </div>
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
        if (event.key === 'Escape' && isPowerSavingOpen && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setIsPowerSavingOpen(false);
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={isPowerSavingOpen}
        primary={generalPage}
        secondary={<PowerSavingPage onBack={() => setIsPowerSavingOpen(false)} />}
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
        </div>
        <p className={styles.caption}>
          Disable automatic playback to reduce power usage. You can still open and play videos. Your
          device’s reduced motion preference also limits automatic playback.
        </p>
      </div>
    </section>
  );
}
