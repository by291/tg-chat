import { Switch } from '@ark-ui/react/switch';
import { ArrowLeft, Check } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import styles from './ArchiveSettingsPage.module.css';

interface ArchiveSettingsPageProps {
  keepUnmutedArchived: boolean;
  hasChanges: boolean;
  onChange: (options: { keepUnmutedArchived: boolean }) => void;
  onBack: () => void;
  onSave: () => void;
}

/** Edit archive preferences with an explicit save and a guarded return to the previous page. */
export function ArchiveSettingsPage({
  keepUnmutedArchived,
  hasChanges,
  onChange,
  onBack,
  onSave,
}: ArchiveSettingsPageProps) {
  return (
    <section className={styles.page} aria-label="Archive Settings">
      <header className={styles.header}>
        <IconButton label="Back from archive settings" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <h2>Archive Settings</h2>
        {hasChanges && (
          <IconButton label="Save archive settings" onClick={onSave}>
            <Check />
          </IconButton>
        )}
      </header>
      <div className={styles.content}>
        <section className={styles.section}>
          <h3>Unmuted Chats</h3>
          <Switch.Root
            className={styles.switchRow}
            checked={keepUnmutedArchived}
            onCheckedChange={(details) => onChange({ keepUnmutedArchived: details.checked })}
          >
            <Switch.Label>Always keep archived</Switch.Label>
            <Switch.Control className={styles.switchControl}>
              <Switch.Thumb className={styles.switchThumb} />
            </Switch.Control>
            <Switch.HiddenInput />
            <Ripple />
          </Switch.Root>
          <p>Keep chats in the archive even if they are unmuted and receive a new message.</p>
        </section>
        <div
          className={styles.folderSection}
          data-visible={!keepUnmutedArchived}
          inert={keepUnmutedArchived}
          aria-hidden={keepUnmutedArchived}
        >
          <div>
            <section className={styles.section}>
              <h3>Chats from folders</h3>
              <Switch.Root className={styles.switchRow} checked={false} disabled>
                <Switch.Label>Always keep archived</Switch.Label>
                <Switch.Control className={styles.switchControl}>
                  <Switch.Thumb className={styles.switchThumb} />
                </Switch.Control>
                <Switch.HiddenInput />
              </Switch.Root>
              <p>Chat folders are not available in this local demo.</p>
            </section>
          </div>
        </div>
        <p className={styles.note}>
          Automatic archiving of new chats from unknown users requires a connected account.
        </p>
      </div>
    </section>
  );
}
