const VOLUME_SCALE = 100;
const SOUND_COOLDOWN = 1000;
const sounds = new Map<string, HTMLAudioElement>();
let lastSoundTime = -Infinity;

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

/** Reflect browser permission without requesting it during page load. */
export function getNotificationPermission(): BrowserNotificationPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Play the original Telegram sound; autoplay restrictions must never interrupt messaging. */
export async function playNotificationSound({
  volume,
  isSent = false,
  isPreview = false,
}: {
  volume: number;
  isSent?: boolean;
  isPreview?: boolean;
}) {
  if (volume <= 0 || (!isPreview && Date.now() - lastSoundTime < SOUND_COOLDOWN)) {
    return;
  }
  lastSoundTime = Date.now();
  const source = isSent ? '/assets/audio/message_sent.mp3' : '/assets/audio/notification.mp3';
  try {
    let sound = sounds.get(source);
    if (!sound) {
      sound = new Audio(source);
      sounds.set(source, sound);
    }
    sound.volume = Math.min(1, Math.max(0, volume / VOLUME_SCALE));
    sound.currentTime = 0;
    await sound.play();
  } catch {
    // A background tab may not have the user activation required for audible playback yet.
  }
}

/** Display a notification only after permission has already been granted by the user. */
export function showMessageNotification({
  title,
  body,
  chatId,
  onOpen,
}: {
  title: string;
  body: string;
  chatId: string;
  onOpen: (chatId: string) => void;
}) {
  if (getNotificationPermission() !== 'granted') {
    return;
  }
  try {
    const notification = new Notification(title, {
      body,
      tag: `chat:${chatId}`,
      silent: true,
    });
    notification.onclick = () => {
      notification.close();
      window.focus();
      onOpen(chatId);
    };
    return notification;
  } catch {
    // Some browsers expose Notification but require a service worker to construct one.
    return;
  }
}
