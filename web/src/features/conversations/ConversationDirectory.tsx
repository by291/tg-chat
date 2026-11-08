import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import { getConversations } from '@/features/chat/state/conversations';
import { resolveConversationEntries, type ConversationListEntry } from './conversationList';

const MAX_TIMEOUT_DELAY = 2_147_483_647;

interface ConversationDirectory {
  conversations: Conversation[];
  privateConversations: Conversation[];
  entries: ConversationListEntry[];
  entriesById: ReadonlyMap<string, ConversationListEntry>;
  now: number;
}

interface ConversationDirectoryProviderProps {
  state: Pick<ChatState, 'localConversations' | 'conversationPreferences'>;
  children: ReactNode;
}

const ConversationDirectoryContext = createContext<ConversationDirectory | undefined>(undefined);

function useMuteDeadline(preferences: ChatState['conversationPreferences']) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const currentTime = Date.now();
    let nextDeadline = Infinity;
    for (const preference of Object.values(preferences ?? {})) {
      const deadline = preference.mutedUntil;
      if (preference.isMuted && deadline && deadline > currentTime) {
        nextDeadline = Math.min(nextDeadline, deadline);
      }
    }

    function refreshTime() {
      setNow(Date.now());
    }

    window.addEventListener('focus', refreshTime);
    document.addEventListener('visibilitychange', refreshTime);
    const timer = Number.isFinite(nextDeadline)
      ? window.setTimeout(refreshTime, Math.min(nextDeadline - currentTime, MAX_TIMEOUT_DELAY))
      : undefined;

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshTime);
      document.removeEventListener('visibilitychange', refreshTime);
    };
  }, [preferences, now]);

  return now;
}

/** Share conversation metadata and one mute deadline scheduler across the chat workspace. */
export function ConversationDirectoryProvider({
  state,
  children,
}: ConversationDirectoryProviderProps) {
  const { localConversations, conversationPreferences } = state;
  const now = useMuteDeadline(conversationPreferences);
  const conversations = useMemo(
    () => getConversations({ localConversations }),
    [localConversations],
  );
  const privateConversations = useMemo(() => {
    return conversations.filter((conversation) => conversation.kind === 'private');
  }, [conversations]);
  const directory = useMemo(
    () => {
      // Preference edits can arrive after a deadline without a timer tick, such as restored state.
      const currentTime = Math.max(now, Date.now());
      const entries = resolveConversationEntries({
        conversations,
        preferences: conversationPreferences,
        now: currentTime,
      });
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

      return {
        conversations,
        privateConversations,
        entries,
        entriesById,
        now: currentTime,
      };
    },
    // prettier-ignore
    [
      conversations,
      privateConversations,
      conversationPreferences,
      now,
    ],
  );

  return (
    <ConversationDirectoryContext.Provider value={directory}>
      {children}
    </ConversationDirectoryContext.Provider>
  );
}

/** Read the workspace's shared catalog and effective conversation preferences. */
export function useConversationDirectory() {
  const directory = useContext(ConversationDirectoryContext);
  if (!directory) {
    throw new Error('Conversation components require a ConversationDirectoryProvider.');
  }

  return directory;
}
