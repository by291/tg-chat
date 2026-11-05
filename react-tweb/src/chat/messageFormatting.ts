import { MESSAGE_GROUP_INTERVAL, type Message } from './model';

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
});

/** Format the timestamp displayed inside a message bubble. */
export function formatMessageTime(timestamp: number): string {
  return timeFormatter.format(timestamp);
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
    return `${message.sticker} Sticker`;
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
    case 'poll':
      return message.media.question;
    default:
      return 'Message';
  }
}
