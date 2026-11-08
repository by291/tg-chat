import type { AppPreferences } from '../app/settings/appPreferences';
import { findSticker } from './stickers/stickerCatalog';
import { MESSAGE_GROUP_INTERVAL, type Message } from './model';

const HOURS_PER_HALF_DAY = 12;

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const militaryTimeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
});

/** Format the timestamp displayed inside a message bubble. */
export function formatMessageTime(
  timestamp: number,
  options: Pick<AppPreferences, 'timeFormat'> = { timeFormat: 'h12' },
): string {
  const formatter = options.timeFormat === 'h23' ? militaryTimeFormatter : timeFormatter;
  return formatter.format(timestamp);
}

/** Convert legacy conversation clock labels while leaving weekday and date labels intact. */
export function formatConversationTime(
  label: string,
  options: Pick<AppPreferences, 'timeFormat'>,
): string {
  const clock = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(label);
  if (!clock || options.timeFormat === 'h12') {
    return label;
  }
  const periodHours = clock[3] === 'PM' ? HOURS_PER_HALF_DAY : 0;
  const hours = (Number(clock[1]) % HOURS_PER_HALF_DAY) + periodHours;
  return `${String(hours).padStart(2, '0')}:${clock[2]}`;
}

/** Format a history date separator, using Today for the current local date. */
export function formatMessageDate(timestamp: number): string {
  if (new Date(timestamp).toDateString() === new Date().toDateString()) {
    return 'Today';
  }

  return dateFormatter.format(timestamp);
}

/** Decide whether adjacent messages share a sender group on the same calendar date. */
export function belongsToSameGroup(message: Message, previous?: Message): boolean {
  if (!previous || message.isService || previous.isService) {
    return false;
  }

  const isSameAuthor = message.authorId === previous.authorId;
  const isSameChat = message.chatId === previous.chatId;
  const isSameDay =
    new Date(message.createdAt).toDateString() === new Date(previous.createdAt).toDateString();
  const isCloseInTime = Math.abs(message.createdAt - previous.createdAt) <= MESSAGE_GROUP_INTERVAL;

  return isSameAuthor && isSameChat && isSameDay && isCloseInTime;
}

/** Describe text and media consistently in previews, replies, and search results. */
export function describeMessage(message?: Message): string {
  if (!message) {
    return 'Deleted message';
  }

  if (message.text) {
    return message.text;
  }

  if (message.sticker) {
    const sticker = findSticker(message.sticker);
    return sticker ? `${sticker.emoji} Sticker` : 'Sticker unavailable';
  }

  if (message.attachment) {
    return 'Photo';
  }

  switch (message.media?.kind) {
    case 'album':
      return `${message.media.photos.length} photos`;
    case 'video':
      return message.media.isRound ? 'Video message' : 'Video';
    case 'voice':
      return 'Voice message';
    case 'document':
      return message.media.name;
    case 'link':
      return message.media.title;
    case 'contact':
      return message.media.name;
    case 'checklist':
      return message.media.title;
    case 'poll':
      return message.media.question;
    default:
      return 'Message';
  }
}
