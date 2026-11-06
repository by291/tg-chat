import { Archive, ArrowLeft, Pencil, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import type { ChatAction, ChatState } from '../model';
import { ConversationPreview, ConversationRemovalDialog } from './ConversationDialogs';
import { ConversationMenu } from './ConversationMenu';
import { SidebarSelectionToolbar } from './SidebarSelectionToolbar';
import { useSidebarActions } from './useSidebarActions';
import {
  getConversationList,
  type ConversationListEntry,
  type ConversationMenuAction,
} from './conversationList';
import { ChatRow } from './ChatRow';
import { SidebarMenu } from './SidebarMenu';
import styles from './ChatSidebar.module.css';

interface ChatSidebarProps {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: () => void;
}

/** Display local conversations and switch to search without losing list position. */
export function ChatSidebar({ state, dispatch, onSelectChat, onToggleTheme }: ChatSidebarProps) {
  const [query, setQuery] = useState('');
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const conversations = getConversationList(state);
  const actions = useSidebarActions({ conversations, dispatch });
  const isSelecting = actions.selectedIds.length > 0;
  const archivedConversations = conversations.filter((conversation) => conversation.isArchived);
  const visibleConversations = conversations.filter(
    (conversation) => conversation.isArchived === isArchiveOpen,
  );
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingChats = conversations.filter((conversation) => {
    return conversation.title.toLowerCase().includes(normalizedQuery);
  });

  useEffect(() => {
    if (!isSearching && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false;
      menuButtonRef.current?.focus();
    }
  }, [isSearching]);

  function closeSearch() {
    shouldRestoreFocus.current = true;
    setIsSearching(false);
    setQuery('');
  }

  function runMenuAction(conversation: ConversationListEntry, action: ConversationMenuAction) {
    if (action === 'select') {
      setIsSearching(false);
      setQuery('');
    }
    actions.runMenuAction(conversation, action);
  }

  function selectChat(chatId: string) {
    setIsSearching(false);
    setQuery('');
    onSelectChat(chatId);
  }

  return (
    <aside
      className={styles.sidebar}
      aria-label="Chat list"
      data-searching={isSearching}
      onKeyDown={(event) => {
        if (isSelecting && event.key === 'Escape') {
          event.preventDefault();
          actions.clearSelection();
          return;
        }
        if (isSearching && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }
      }}
    >
      {isSelecting && (
        <SidebarSelectionToolbar
          conversations={actions.selectedConversations}
          onClear={actions.clearSelection}
          onUpdate={actions.applySelectionChanges}
          onDelete={actions.requestSelectionRemoval}
        />
      )}
      {!isSelecting && isArchiveOpen && !isSearching && (
        <div className={styles.header}>
          <IconButton label="Back to conversations" onClick={() => setIsArchiveOpen(false)}>
            <ArrowLeft />
          </IconButton>
          <h2 className={styles.archiveTitle}>Archived Chats</h2>
        </div>
      )}
      {!isSelecting && (!isArchiveOpen || isSearching) && (
        <div className={styles.header}>
          <SidebarMenu
            isSearching={isSearching}
            isDark={state.isDark}
            menuButtonRef={menuButtonRef}
            onCloseSearch={closeSearch}
            onSelectChat={selectChat}
            onToggleTheme={onToggleTheme}
          />
          <div className={styles.searchField}>
            <Search className={styles.searchIcon} size={24} aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="Search conversations"
              placeholder="Search"
              value={query}
              onFocus={() => setIsSearching(true)}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <IconButton
                label="Clear search"
                className={styles.clearSearch}
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                <X />
              </IconButton>
            )}
          </div>
        </div>
      )}
      <div className={styles.content}>
        <div className={styles.conversationsPanel} inert={isSearching} aria-hidden={isSearching}>
          <nav
            className={styles.chatList}
            aria-label={isArchiveOpen ? 'Archived conversations' : 'Conversations'}
          >
            {!isArchiveOpen && archivedConversations.length > 0 && (
              <button
                className={styles.archiveEntry}
                onClick={() => {
                  actions.clearSelection();
                  setIsArchiveOpen(true);
                }}
              >
                <span className={styles.archiveAvatar}>
                  <Archive />
                </span>
                <span className={styles.rowContent}>
                  <strong>Archived Chats</strong>
                  <span>
                    {archivedConversations.map((conversation) => conversation.title).join(', ')}
                  </span>
                </span>
                <span className={styles.archiveCount}>{archivedConversations.length}</span>
                <Ripple />
              </button>
            )}
            {visibleConversations.map((conversation) => (
              <ChatRow
                key={conversation.id}
                conversation={conversation}
                state={state}
                isSelecting={isSelecting}
                isSelected={actions.selectedIds.includes(conversation.id)}
                onMenuAction={(action) => runMenuAction(conversation, action)}
                onSelect={() => {
                  if (isSelecting) {
                    actions.toggleSelection(conversation.id);
                    return;
                  }
                  selectChat(conversation.id);
                }}
              />
            ))}
            {visibleConversations.length === 0 && <p className={styles.empty}>No conversations</p>}
          </nav>
          <div className={styles.footer}>
            <IconButton
              label="Open dev conversation"
              className={styles.composeButton}
              onClick={() => selectChat('dev')}
            >
              <Pencil />
            </IconButton>
          </div>
        </div>
        <nav
          className={styles.searchPanel}
          aria-label="Search results"
          aria-hidden={!isSearching}
          inert={!isSearching}
        >
          <div className={styles.searchCard}>
            <h2>Chats</h2>
            {matchingChats.map((conversation) => (
              <ConversationMenu
                key={conversation.id}
                conversation={conversation}
                isSelecting={false}
                onAction={(action) => runMenuAction(conversation, action)}
              >
                <button
                  type="button"
                  className={styles.searchResult}
                  onClick={() => selectChat(conversation.id)}
                >
                  <Avatar
                    initials={conversation.initials}
                    color={conversation.color}
                    size="small"
                  />
                  <span className={styles.rowContent}>
                    <span className={styles.resultTitle}>{conversation.title}</span>
                    <span className={styles.resultSubtitle}>{conversation.subtitle}</span>
                  </span>
                  <Ripple />
                </button>
              </ConversationMenu>
            ))}
            {matchingChats.length === 0 && <p className={styles.empty}>No conversations found</p>}
          </div>
        </nav>
      </div>
      <ConversationPreview
        conversation={actions.preview}
        state={state}
        onClose={actions.closePreview}
        onOpen={selectChat}
      />
      <ConversationRemovalDialog
        request={actions.confirmation}
        onCancel={actions.cancelRemoval}
        onConfirm={actions.confirmRemoval}
      />
    </aside>
  );
}
