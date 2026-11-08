import { trimEmojiText, type CustomEmojiEntity } from '@/features/emoji/customEmojiEntities';
import type { Dispatch } from 'react';
import { CURRENT_USER_ID, type ChatAction, type Message } from '../model';

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
  const captionContent = trimEmojiText({
    text: caption ?? '',
    richText,
    customEmoji,
  });
  if (captionContent.text || captionContent.richText) {
    // The recipient's existing draft belongs to its composer, not the share dialog.
    dispatch({
      type: 'forward',
      message: {
        id: crypto.randomUUID(),
        chatId,
        authorId: CURRENT_USER_ID,
        authorName: 'You',
        ...captionContent,
        createdAt: Date.now(),
        reactions: [],
      },
    });
  }

  for (const source of messages) {
    dispatch({
      type: 'forward',
      message: {
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
      },
    });
  }
}
