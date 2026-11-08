import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useEffect, useState } from 'react';
import type { Conversation } from '@/domain/conversations/conversation';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_NOTIFICATION_VOLUME,
  setNotificationPreferences,
  useNotificationPreferences,
  type NotificationCategory,
  type NotificationPreferences,
} from './notificationPreferences';
import { getNotificationPermission, playNotificationSound } from './notificationDelivery';
import { showToast } from '@/components/toastStore';
import { SettingsHeader, SettingsRange, SettingsSwitch } from '../SettingsControls';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import { useClosingDialogValue } from '@/hooks/useClosingDialogValue';
import styles from '../SettingsPage.module.css';
import notifications from './NotificationSettingsPage.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import dialogs from '@/components/overlays/dialogs.module.css';

const NOTIFICATION_CATEGORIES = [
  { kind: 'private', title: 'Private Chats', label: 'Notifications for private chats' },
  { kind: 'group', title: 'Groups', label: 'Notifications for groups' },
  { kind: 'channel', title: 'Channels', label: 'Notifications for channels' },
] as const;

export interface NotificationChatActions {
  conversations: Conversation[];
  onSetMuted: (options: { chatId: string; isMuted: boolean }) => void;
  onResetMutes: () => void;
}

interface NotificationSettingsPageProps extends NotificationChatActions {
  onBack: () => void;
}

function savePreferences(changes: Partial<NotificationPreferences>) {
  if (!setNotificationPreferences(changes)) {
    showToast('Notifications changed, but could not be saved on this device.');
  }
}

/** Configure supported local notifications while preserving the future offline-delivery option. */
export function NotificationSettingsPage({
  conversations,
  onSetMuted,
  onResetMutes,
  onBack,
}: NotificationSettingsPageProps) {
  const preferences = useNotificationPreferences();
  const [permission, setPermission] = useState(getNotificationPermission);
  const [isRequesting, setIsRequesting] = useState(false);
  const [exceptionCategory, setExceptionCategory] = useState<NotificationCategory>();
  const closingCategory = useClosingDialogValue(exceptionCategory);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const hasPermission = permission === 'granted';

  useEffect(() => {
    const refreshPermission = () => setPermission(getNotificationPermission());
    window.addEventListener('focus', refreshPermission);
    document.addEventListener('visibilitychange', refreshPermission);
    return () => {
      window.removeEventListener('focus', refreshPermission);
      document.removeEventListener('visibilitychange', refreshPermission);
    };
  }, []);

  async function enableNotifications() {
    if (permission === 'unsupported' || isRequesting) {
      return;
    }
    setIsRequesting(true);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission === 'granted') {
        savePreferences({ shouldShowNotifications: true });
      } else {
        showToast('Allow notifications in your browser site settings to enable them.');
      }
    } catch {
      showToast('This browser could not enable notifications. Check its site settings.');
    } finally {
      setIsRequesting(false);
    }
  }

  function updateCategory(
    kind: NotificationCategory,
    changes: Partial<NotificationPreferences['group']>,
  ) {
    savePreferences({ [kind]: { ...preferences[kind], ...changes } });
  }

  function resetNotifications() {
    savePreferences(structuredClone(DEFAULT_NOTIFICATION_PREFERENCES));
    onResetMutes();
    setIsResetOpen(false);
    showToast('Notification settings reset.');
  }

  let permissionCaption = 'Notifications are shown while this app is open.';
  if (permission === 'unsupported') {
    permissionCaption = 'Desktop notifications are not supported by this browser.';
  } else if (!hasPermission) {
    permissionCaption = 'Allow notifications for this site in your browser to receive alerts.';
  }

  const overview = (
    <section className={styles.page} aria-label="Notifications">
      <SettingsHeader title="Notifications" backLabel="Back from notifications" onBack={onBack} />
      <div className={styles.scrollContent}>
        <section className={styles.section} aria-label="Web Notifications">
          <h3>Web Notifications</h3>
          <SettingsSwitch
            label="Show notifications"
            isChecked={hasPermission && preferences.shouldShowNotifications}
            isDisabled={!hasPermission}
            onChange={({ isChecked }) => savePreferences({ shouldShowNotifications: isChecked })}
          />
          <SettingsSwitch
            label="Show offline notifications"
            isChecked={false}
            isDisabled
            onChange={({ isChecked }) =>
              savePreferences({ shouldShowOfflineNotifications: isChecked })
            }
          />
          <p className={notifications.note}>Offline notifications are not available yet.</p>
          {!hasPermission && permission !== 'unsupported' && (
            <button
              className={notifications.action}
              onClick={() => void enableNotifications()}
              disabled={isRequesting}
            >
              {isRequesting ? 'Waiting for permission' : 'Enable Notifications'}
            </button>
          )}
        </section>
        <p className={styles.caption}>{permissionCaption}</p>
        <section className={styles.section} aria-label="Sound">
          <h3>Sound</h3>
          <SettingsSwitch
            label="Notification Sound"
            isChecked={preferences.shouldPlaySound}
            onChange={({ isChecked }) =>
              savePreferences({
                shouldPlaySound: isChecked,
                volume: preferences.volume || DEFAULT_NOTIFICATION_VOLUME,
              })
            }
          />
          <SettingsRange
            label="Sound Volume"
            value={preferences.volume}
            unit="%"
            minimum={0}
            maximum={100}
            onChange={(volume) =>
              savePreferences({
                volume,
                shouldPlaySound: volume > 0 && preferences.shouldPlaySound,
              })
            }
            onChangeEnd={(volume) => void playNotificationSound({ volume, isPreview: true })}
          />
        </section>
        <p className={styles.caption}>Drag and release or click to test the volume.</p>
        <section className={styles.section} aria-label="Sound Effects">
          <h3>Sound Effects</h3>
          <SettingsSwitch
            label="Message Sent"
            isChecked={preferences.shouldPlaySentSound}
            onChange={({ isChecked }) => savePreferences({ shouldPlaySentSound: isChecked })}
          />
        </section>
        {NOTIFICATION_CATEGORIES.map(({ kind, title, label }) => {
          const mutedChats = conversations.filter((chat) => chat.kind === kind && chat.isMuted);
          return (
            <section key={kind} className={styles.section} aria-label={title}>
              <h3>{title}</h3>
              <SettingsSwitch
                label={label}
                isChecked={preferences[kind].shouldNotify}
                onChange={({ isChecked }) => updateCategory(kind, { shouldNotify: isChecked })}
              />
              <SettingsSwitch
                label="Message Preview"
                isChecked={preferences[kind].shouldShowPreview}
                onChange={({ isChecked }) => updateCategory(kind, { shouldShowPreview: isChecked })}
              />
              <button className={styles.row} onClick={() => setExceptionCategory(kind)}>
                <span className={styles.label}>Exceptions</span>
                <span className={styles.value}>{mutedChats.length || ''}</span>
              </button>
            </section>
          );
        })}
        <section className={styles.section}>
          <button
            className={`${notifications.action} ${notifications.danger}`}
            onClick={() => setIsResetOpen(true)}
          >
            Reset All Notifications
          </button>
        </section>
        <p className={styles.caption}>Reset notification preferences and unmute all chats.</p>
      </div>
    </section>
  );

  return (
    <div
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && exceptionCategory && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setExceptionCategory(undefined);
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={Boolean(exceptionCategory)}
        primary={overview}
        secondary={
          <NotificationExceptions
            conversations={conversations.filter((chat) => chat.kind === closingCategory)}
            onSetMuted={onSetMuted}
            onBack={() => setExceptionCategory(undefined)}
          />
        }
      />
      <Dialog.Root
        role="alertdialog"
        open={isResetOpen}
        onOpenChange={({ open }) => setIsResetOpen(open)}
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop className={dialogs.backdrop} />
          <Dialog.Positioner className={overlays.dialogPositioner}>
            <Dialog.Content className={`${overlays.dialog} ${dialogs.confirmation}`}>
              <Dialog.Title>Reset Notifications</Dialog.Title>
              <Dialog.Description>
                Reset all notification preferences and unmute all private chats, groups and
                channels?
              </Dialog.Description>
              <div className={overlays.dialogActions}>
                <Dialog.CloseTrigger className={overlays.textButton}>Cancel</Dialog.CloseTrigger>
                <button className={overlays.textButton} onClick={resetNotifications}>
                  Reset
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
}

function NotificationExceptions({
  conversations,
  onSetMuted,
  onBack,
}: Omit<NotificationSettingsPageProps, 'onResetMutes'>) {
  return (
    <section className={styles.page} aria-label="Notification Exceptions">
      <SettingsHeader
        title="Exceptions"
        backLabel="Back from notification exceptions"
        onBack={onBack}
      />
      <div className={styles.scrollContent}>
        <section className={styles.section}>
          {conversations.map((conversation) => (
            <SettingsSwitch
              key={conversation.id}
              label={conversation.title}
              isChecked={!conversation.isMuted}
              onChange={({ isChecked }) =>
                onSetMuted({ chatId: conversation.id, isMuted: !isChecked })
              }
            />
          ))}
          {conversations.length === 0 && <p className={styles.empty}>No chats in this category</p>}
        </section>
        <p className={styles.caption}>
          Turn off a chat to mute it individually. Category notification settings still apply.
        </p>
      </div>
    </section>
  );
}
