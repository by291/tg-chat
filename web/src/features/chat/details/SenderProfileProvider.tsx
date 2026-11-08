import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import type { Message } from '@/domain/messages/message';
import { getContactColor } from '../messages/content/contact/ContactActions';
import { useConversationDirectory } from '@/features/conversations/ConversationDirectory';
import { EMPTY_CONVERSATION_MESSAGES } from '@/features/conversations/conversationMessages';
import { SenderProfileDialog } from './SenderProfileDialog';

export type SenderIdentity = Pick<Message, 'authorId' | 'authorName'>;

interface SenderProfileActions {
  getPeer: (sender: SenderIdentity) => Conversation;
  openProfile: (sender: SenderIdentity) => void;
}

interface SenderProfileProviderProps {
  state: ChatState;
  messagesByChatId: ReadonlyMap<string, Message[]>;
  dispatch: Dispatch<ChatAction>;
  onSelectConversation: (chatId: string) => void;
  onOpenMedia: (message: Message) => void;
  children: ReactNode;
}

const SenderProfileContext = createContext<SenderProfileActions | undefined>(undefined);

/** Route sender avatars to user profiles or directly to broadcast channels. */
export function SenderProfileProvider({
  state,
  messagesByChatId,
  dispatch,
  onSelectConversation,
  onOpenMedia,
  children,
}: SenderProfileProviderProps) {
  const [sender, setSender] = useState<SenderIdentity>();
  const [isOpen, setIsOpen] = useState(false);
  const { conversations, entriesById, now } = useConversationDirectory();

  useEffect(() => {
    setIsOpen(false);
  }, [state.activeChatId]);

  const getPeer = useCallback(
    (identity: SenderIdentity): Conversation => {
      const peer = conversations.find((candidate) => {
        return (
          candidate.id === identity.authorId || candidate.id === `contact:${identity.authorId}`
        );
      });
      if (peer) {
        return peer;
      }

      // Reading a profile must not create a chat or invent server-owned presence information.
      return {
        id: `contact:${identity.authorId}`,
        title: identity.authorName,
        subtitle: '',
        initials: identity.authorName.slice(0, 1).toUpperCase(),
        color: getContactColor(identity.authorId),
        kind: 'private',
        preview: '',
        time: '',
        isContact: false,
      };
    },
    [conversations],
  );

  const openProfile = useCallback(
    (identity: SenderIdentity) => {
      const peer = getPeer(identity);
      if (peer.kind === 'channel') {
        setIsOpen(false);
        onSelectConversation(peer.id);
        return;
      }
      setSender(identity);
      setIsOpen(true);
    },
    [getPeer, onSelectConversation],
  );
  const profileActions = useMemo(() => ({ getPeer, openProfile }), [getPeer, openProfile]);

  const peer = sender ? getPeer(sender) : undefined;
  const preferences = peer ? state.conversationPreferences?.[peer.id] : undefined;
  const hasMuteExpired = Boolean(preferences?.mutedUntil && preferences.mutedUntil <= now);
  const isMuted =
    entriesById.get(peer?.id ?? '')?.isMuted ?? (Boolean(preferences?.isMuted) && !hasMuteExpired);

  function openConversation() {
    if (!peer) {
      return;
    }
    if (!conversations.some((candidate) => candidate.id === peer.id)) {
      // Persist before selection so navigation can resolve an uncached sender on the next render.
      dispatch({ type: 'save-conversation', conversation: peer });
    }
    setIsOpen(false);
    onSelectConversation(peer.id);
  }

  return (
    <SenderProfileContext.Provider value={profileActions}>
      {children}
      {peer && (
        <SenderProfileDialog
          conversation={peer}
          messages={messagesByChatId.get(peer.id) ?? EMPTY_CONVERSATION_MESSAGES}
          state={state}
          dispatch={dispatch}
          isOpen={isOpen}
          isMuted={isMuted}
          onClose={() => setIsOpen(false)}
          onMessage={openConversation}
          onToggleMute={() => {
            dispatch({
              type: 'update-conversations',
              chatIds: [peer.id],
              changes: { isMuted: !isMuted, mutedUntil: 0 },
            });
          }}
          onOpenMedia={(message) => {
            setIsOpen(false);
            onOpenMedia(message);
          }}
        />
      )}
    </SenderProfileContext.Provider>
  );
}

/** Read the profile routing supplied by the application shell. */
export function useSenderProfile() {
  return useContext(SenderProfileContext);
}
