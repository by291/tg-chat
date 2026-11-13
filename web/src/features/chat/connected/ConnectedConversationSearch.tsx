import type { components } from '@/api/schema';
import type { Message } from '@/domain/messages/message';
import type { ChatOwner } from '../data/ChatOwner';
import type { Conversation } from '../data/messageModels';
import { ChatSearch } from '../search/ChatSearch';
import styles from './ConnectedConversationSearch.module.css';

interface ConnectedConversationSearchProps {
  owner: ChatOwner;
  conversation: Conversation;
  messages: Message[];
  user: components['schemas']['PrivateProfile'];
  onClose: () => void;
}

/** Adapt the active conversation's search and authorized jumps to the search panel. */
export function ConnectedConversationSearch({
  owner,
  conversation,
  messages,
  user,
  onClose,
}: ConnectedConversationSearchProps) {
  return (
    <div className={styles.searchSlot} data-conversation-search data-chat-controls>
      <ChatSearch
        key={conversation.id}
        messages={messages}
        canFilterSender={conversation.kind !== 'saved'}
        onClose={onClose}
        onJump={(messageId) => owner.jumpToMessage(messageId, { shouldRevalidate: true })}
        source={{
          conversationId: conversation.id,
          visibilityKey: owner.searchVisibilityKey(conversation.id),
          loadPage: owner.searchMessages,
          onJumpToDate: (timestamp) => owner.jumpToDate(timestamp),
          senderRoster:
            conversation.kind === 'group'
              ? { revision: conversation.generation, loadPage: owner.loadSearchSenders }
              : undefined,
          senders:
            conversation.kind === 'direct'
              ? [
                  { id: user.id, name: user.display_name },
                  { id: conversation.peer_id, name: conversation.peer_name },
                ]
              : undefined,
        }}
      />
    </div>
  );
}
