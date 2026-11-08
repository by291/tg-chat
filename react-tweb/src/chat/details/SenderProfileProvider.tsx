import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { ChatAction, ChatState, Conversation, Message } from '../model';
import { getContactColor } from '../messages/ContactActions';
import { useConversationList } from '../sidebar/conversationList';
import { getConversations } from '../state/conversations';
import { SenderProfileDialog } from './SenderProfileDialog';

export type SenderIdentity = Pick<Message, 'authorId' | 'authorName'>;

interface SenderProfileActions {
  getPeer: (sender: SenderIdentity) => Conversation;
  openProfile: (sender: SenderIdentity) => void;
}

interface SenderProfileProviderProps {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onSelectConversation: (chatId: string) => void;
  onOpenMedia: (message: Message) => void;
  children: ReactNode;
}

const SenderProfileContext = createContext<SenderProfileActions | undefined>(undefined);

/** Route sender avatars to user profiles or directly to broadcast channels. */
export function SenderProfileProvider({
  state,
  dispatch,
  onSelectConversation,
  onOpenMedia,
  children,
}: SenderProfileProviderProps) {
  const [sender, setSender] = useState<SenderIdentity>();
  const [isOpen, setIsOpen] = useState(false);
  const conversations = getConversations(state);
  const entries = useConversationList(state);

  useEffect(() => {
    setIsOpen(false);
  }, [state.activeChatId]);

  function getPeer(identity: SenderIdentity): Conversation {
    const peer = conversations.find((candidate) => {
      return candidate.id === identity.authorId || candidate.id === `contact:${identity.authorId}`;
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
  }

  function openProfile(identity: SenderIdentity) {
    const peer = getPeer(identity);
    if (peer.kind === 'channel') {
      setIsOpen(false);
      onSelectConversation(peer.id);
      return;
    }
    setSender(identity);
    setIsOpen(true);
  }

  const peer = sender ? getPeer(sender) : undefined;
  const preferences = peer ? state.conversationPreferences?.[peer.id] : undefined;
  const hasMuteExpired = Boolean(preferences?.mutedUntil && preferences.mutedUntil <= Date.now());
  const isMuted =
    entries.find((entry) => entry.id === peer?.id)?.isMuted ??
    (Boolean(preferences?.isMuted) && !hasMuteExpired);

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
    <SenderProfileContext.Provider value={{ getPeer, openProfile }}>
      {children}
      {peer && (
        <SenderProfileDialog
          conversation={peer}
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
