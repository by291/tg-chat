import { trimEmojiText, type CustomEmojiEntity } from '@/domain/messages/customEmoji';
import type { Dispatch } from 'react';
import { CURRENT_USER_ID } from '@/domain/identity';
import { type ChatAction } from '@/features/chat/state/chatActions';
import { type Message } from '@/domain/messages/message';

interface ForwardMessagesOptions {
  messages: Message[];
  chatId: string;
  caption?: string;
  richText?: string;
  customEmoji?: CustomEmojiEntity[];
  dispatch: Dispatch<ChatAction>;
}

/** Send independent local copies without transferring source pins, reactions or reply links. */
export function forwardMessages({
  messages,
  chatId,
  caption,
  richText,
  customEmoji,
  dispatch,
}: ForwardMessagesOptions) {
  const forwardedMessages: Message[] = [];
  const captionContent = trimEmojiText({
    text: caption ?? '',
    richText,
    customEmoji,
  });
  if (captionContent.text || captionContent.richText) {
    // The recipient's existing draft belongs to its composer, not the share dialog.
    forwardedMessages.push({
      id: crypto.randomUUID(),
      chatId,
      authorId: CURRENT_USER_ID,
      authorName: 'You',
      ...captionContent,
      createdAt: Date.now(),
      reactions: [],
    });
  }

  for (const source of messages) {
    forwardedMessages.push({
      id: crypto.randomUUID(),
      chatId,
      authorId: CURRENT_USER_ID,
      authorName: 'You',
      text: source.text,
      richText: source.richText,
      customEmoji: source.customEmoji,
      attachment: source.attachment,
      media: source.media,
      sticker: source.sticker,
      textStyle: source.textStyle,
      forwardedFrom: source.forwardedFrom ?? source.authorName,
      createdAt: Date.now(),
      reactions: [],
    });
  }

  if (forwardedMessages.length) {
    dispatch({ type: 'forward-messages', messages: forwardedMessages });
  }
}
