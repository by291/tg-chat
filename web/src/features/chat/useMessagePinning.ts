import { useCallback, useState, type Dispatch } from 'react';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { Message } from '@/domain/messages/message';

const PIN_CONFIRMATION_DELAY_MS = 300;

export interface MessagePinRequest {
  chatId: string;
  messageId: string;
  isPinned: boolean;
}

/** Share confirmation and commit ordering between message menus and the pinned message bar. */
export function useMessagePinning(dispatch: Dispatch<ChatAction>) {
  const [request, setRequest] = useState<MessagePinRequest>();

  const requestChange = useCallback((message: Message) => {
    setRequest({
      chatId: message.chatId,
      messageId: message.id,
      isPinned: !message.isPinned,
    });
  }, []);

  function confirmChange() {
    if (!request) {
      return;
    }

    const confirmedRequest = request;
    setRequest(undefined);
    // Match Telegram: let the popup leave before changing the underlying message and topbar.
    // The app owns this confirmed action; leaving the chat must not cancel or retarget it.
    window.setTimeout(() => {
      dispatch({ type: 'pin', ...confirmedRequest });
    }, PIN_CONFIRMATION_DELAY_MS);
  }

  return {
    request,
    requestChange,
    confirmChange,
    cancelChange: () => setRequest(undefined),
  };
}
