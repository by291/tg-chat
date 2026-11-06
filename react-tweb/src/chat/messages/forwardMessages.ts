import type { Dispatch } from 'react';
import { CURRENT_USER_ID, type ChatAction, type Message } from '../model';

interface ForwardMessagesOptions {
  messages: Message[];
  chatId: string;
  caption?: string;
  dispatch: Dispatch<ChatAction>;
}

/** Send independent local copies without transferring source pins, reactions or reply links. */
export function forwardMessages({ messages, chatId, caption, dispatch }: ForwardMessagesOptions) {
  if (caption?.trim()) {
    // The recipient's existing draft belongs to its composer, not the share dialog.
    dispatch({
      type: 'forward',
      message: {
        id: crypto.randomUUID(),
        chatId,
        authorId: CURRENT_USER_ID,
        authorName: 'You',
        text: caption,
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
