import { useState, type Dispatch } from 'react';
import { ChatHeader } from './ChatHeader';
import { DeleteMessageDialog } from './DeleteMessageDialog';
import { MessageComposer, type ComposedMessage } from './MessageComposer';
import { MessageTimeline, type MessageNavigation } from './MessageTimeline';
import { describeMessage } from './messageFormatting';
import type { ChatAction, ChatState, Conversation, Message, MessageCommand } from './model';
import styles from './ChatApp.module.css';

interface ConversationPaneProps {
  conversation: Conversation;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onOpenDetails: () => void;
  onOpenMedia: (message: Message) => void;
  onBack: () => void;
  onNotify: (message: string) => void;
}

/** Coordinate message commands and transient editing state for one selected conversation. */
export function ConversationPane({
  conversation,
  state,
  dispatch,
  onOpenDetails,
  onOpenMedia,
  onBack,
  onNotify,
}: ConversationPaneProps) {
  const [replyMessage, setReplyMessage] = useState<Message>();
  const [editingMessage, setEditingMessage] = useState<Message>();
  const [pendingDelete, setPendingDelete] = useState<Message>();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [navigation, setNavigation] = useState<MessageNavigation>();
  const messages = state.messages.filter((message) => message.chatId === conversation.id);
  const searchResultCount = messages.filter((message) => {
    return describeMessage(message).toLowerCase().includes(searchQuery.trim().toLowerCase());
  }).length;

  function clearComposerContext() {
    setReplyMessage(undefined);
    setEditingMessage(undefined);
  }

  function submitMessage(composed: ComposedMessage) {
    if (editingMessage) {
      dispatch({
        type: 'edit',
        chatId: conversation.id,
        messageId: editingMessage.id,
        text: composed.text,
      });
      clearComposerContext();
      return;
    }

    dispatch({
      type: 'send',
      message: {
        id: crypto.randomUUID(),
        chatId: conversation.id,
        authorId: 'you',
        authorName: 'You',
        text: composed.text,
        createdAt: Date.now(),
        attachment: composed.attachment,
        sticker: composed.sticker,
        replyToId: replyMessage?.id,
        reactions: [],
      },
    });
    clearComposerContext();
    setSearchQuery('');
    setIsSearchOpen(false);
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(describeMessage(message));
      onNotify('Copied to clipboard');
    } catch {
      onNotify('Could not access the clipboard. Select the message text to copy it.');
    }
  }

  function applyMessageCommand({ action, message }: MessageCommand) {
    switch (action) {
      case 'reply':
        setReplyMessage(message);
        setEditingMessage(undefined);
        return;
      case 'edit':
        setEditingMessage(message);
        setReplyMessage(undefined);
        return;
      case 'delete':
        setPendingDelete(message);
        return;
      case 'copy':
        void copyMessage(message);
        return;
      case 'pin':
        dispatch({ type: 'pin', chatId: conversation.id, messageId: message.id });
    }
  }

  function jumpToMessage(messageId: string) {
    setSearchQuery('');
    setIsSearchOpen(false);
    setNavigation({ messageId, requestId: Date.now() });
  }

  function toggleSearch() {
    setIsSearchOpen(!isSearchOpen);
    setSearchQuery('');
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }

    dispatch({ type: 'delete', chatId: conversation.id, messageId: pendingDelete.id });
    if (editingMessage?.id === pendingDelete.id || replyMessage?.id === pendingDelete.id) {
      clearComposerContext();
    }

    setPendingDelete(undefined);
  }

  return (
    <main className={styles.conversation} aria-label={`${conversation.title} conversation`}>
      <ChatHeader
        conversation={conversation}
        isSearchOpen={isSearchOpen}
        searchQuery={searchQuery}
        searchResultCount={searchResultCount}
        onSearchQueryChange={setSearchQuery}
        onToggleSearch={toggleSearch}
        onOpenDetails={onOpenDetails}
        onBack={onBack}
        onToggleTheme={() => dispatch({ type: 'toggle-theme' })}
      />
      <MessageTimeline
        messages={messages}
        searchQuery={searchQuery}
        navigation={navigation}
        onCommand={applyMessageCommand}
        onReact={(messageId, emoji) => {
          dispatch({ type: 'react', chatId: conversation.id, messageId, emoji });
        }}
        onOpenMedia={onOpenMedia}
        onJumpToMessage={jumpToMessage}
      />
      <MessageComposer
        key={editingMessage?.id || 'compose'}
        draft={state.drafts[conversation.id] || ''}
        replyMessage={replyMessage}
        editingMessage={editingMessage}
        onDraftChange={(text) => dispatch({ type: 'set-draft', chatId: conversation.id, text })}
        onSubmit={submitMessage}
        onCancelContext={clearComposerContext}
        onNotify={onNotify}
      />
      <DeleteMessageDialog
        isOpen={Boolean(pendingDelete)}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={confirmDelete}
      />
    </main>
  );
}
