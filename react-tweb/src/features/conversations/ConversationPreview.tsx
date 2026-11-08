import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { MessageTimeline } from '@/features/chat/history/MessageTimeline';
import type { ChatState } from '@/features/chat/state/chatState';
import type { ConversationListEntry } from './conversationList';
import {
  getPreviewPosition,
  PREVIEW_MOBILE_BREAKPOINT,
  type PreviewAnchor,
} from './previewPosition';
import styles from './ConversationPreview.module.css';
import { useClosingDialogValue } from '@/hooks/useClosingDialogValue';

export interface ConversationPreviewRequest {
  chatId: string;
  anchor: PreviewAnchor;
}

interface ConversationPreviewProps {
  request?: ConversationPreviewRequest;
  conversation?: ConversationListEntry;
  state: ChatState;
  onClose: () => void;
  onToggleRead: () => void;
}

function ignorePreviewCommand() {
  // Preview bubbles are inert; this boundary never dispatches message mutations.
}

/** Peek at the real message renderer beside a row without opening or reading the conversation. */
export function ConversationPreview({
  request: openRequest,
  conversation: openConversation,
  state,
  onClose,
  onToggleRead,
}: ConversationPreviewProps) {
  const request = useClosingDialogValue(openRequest);
  const conversation = useClosingDialogValue(openConversation);
  const position = useMemo(() => {
    return request ? getPreviewPosition(request.anchor) : undefined;
  }, [request]);
  const messages = useMemo(() => {
    return state.messages.filter((message) => message.chatId === request?.chatId);
  }, [state.messages, request?.chatId]);

  useEffect(() => {
    if (!openRequest) {
      return;
    }
    // The anchor belongs to the old viewport; close rather than keep a detached preview.
    window.addEventListener('resize', onClose);
    return () => window.removeEventListener('resize', onClose);
  }, [openRequest, onClose]);

  return (
    <Dialog.Root
      open={Boolean(openRequest && openConversation)}
      modal={window.innerWidth <= PREVIEW_MOBILE_BREAKPOINT}
      preventScroll={false}
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Content className={styles.preview} style={position} aria-label="Chat preview">
          {conversation && (
            <>
              <header className={styles.header}>
                <IconButton label="Close preview" onClick={onClose}>
                  <X />
                </IconButton>
                <Avatar initials={conversation.initials} color={conversation.color} size="small" />
                <div>
                  <Dialog.Title>{conversation.title}</Dialog.Title>
                  <Dialog.Description>{conversation.subtitle}</Dialog.Description>
                </div>
              </header>
              <MessageTimeline
                key={conversation.id}
                messages={messages}
                shouldShowSender={conversation.kind === 'group'}
                searchQuery=""
                isPreview
                onCommand={ignorePreviewCommand}
                onReact={ignorePreviewCommand}
                onInteract={ignorePreviewCommand}
                onOpenMedia={ignorePreviewCommand}
                onJumpToMessage={ignorePreviewCommand}
              />
              <button type="button" className={styles.readButton} onClick={onToggleRead}>
                {conversation.hasUnread ? 'Mark as read' : 'Mark as unread'}
                <Ripple />
              </button>
            </>
          )}
        </Dialog.Content>
      </Portal>
    </Dialog.Root>
  );
}
