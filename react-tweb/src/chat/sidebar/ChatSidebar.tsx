import { Archive, ArrowLeft, Pencil, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import type { ChatAction, ChatState } from '../model';
import { ConversationRemovalDialog } from './ConversationDialogs';
import { ConversationPreview } from './ConversationPreview';
import { ConversationMuteDialog } from './ConversationMuteDialog';
import { VirtualConversationList } from './VirtualConversationList';
import { readPreviewAnchor, type PreviewAnchor } from './previewPosition';
import { ConversationMenu } from './ConversationMenu';
import { SidebarSelectionToolbar } from './SidebarSelectionToolbar';
import { useSidebarActions } from './useSidebarActions';
import {
  useConversationList,
  type ConversationListEntry,
  type ConversationMenuAction,
} from './conversationList';
import { ChatRow } from './ChatRow';
import { SidebarMenu } from './SidebarMenu';
import styles from './ChatSidebar.module.css';

const SELECTION_FADE_SECONDS = 0.2;

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
  const conversations = useConversationList(state);
  const scrollOffsets = useRef({ inbox: 0, archive: 0 });
  const listScope = isArchiveOpen ? 'archive' : 'inbox';
  const shouldReduceMotion = useReducedMotion();
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

  function runMenuAction(
    conversation: ConversationListEntry,
    action: ConversationMenuAction,
    anchor?: PreviewAnchor,
  ) {
    if (action === 'select') {
      setIsSearching(false);
      setQuery('');
      setIsArchiveOpen(conversation.isArchived);
    }
    actions.runMenuAction(conversation, action, anchor);
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
      data-selecting={isSelecting}
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
      <div className={styles.headerSlot}>
        <AnimatePresence initial={false}>
          {isSelecting && (
            <motion.div
              key="selection"
              className={styles.selectionPlate}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : SELECTION_FADE_SECONDS }}
            >
              <SidebarSelectionToolbar
                conversations={actions.selectedConversations}
                onClear={actions.clearSelection}
                onUpdate={actions.applySelectionChanges}
                onDelete={actions.requestSelectionRemoval}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div inert={isSelecting} aria-hidden={isSelecting}>
          {isArchiveOpen && !isSearching && (
            <div className={styles.header}>
              <IconButton label="Back to conversations" onClick={() => setIsArchiveOpen(false)}>
                <ArrowLeft />
              </IconButton>
              <h2 className={styles.archiveTitle}>Archived Chats</h2>
            </div>
          )}
          {(!isArchiveOpen || isSearching) && (
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
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.conversationsPanel} inert={isSearching} aria-hidden={isSearching}>
          <VirtualConversationList
            key={listScope}
            conversations={visibleConversations}
            label={isArchiveOpen ? 'Archived conversations' : 'Conversations'}
            initialOffset={scrollOffsets.current[listScope]}
            onScrollOffsetChange={(offset) => {
              scrollOffsets.current[listScope] = offset;
            }}
            onReorderPinned={(chatIds) =>
              dispatch({ type: 'reorder-pinned-conversations', chatIds })
            }
            archiveEntry={
              !isArchiveOpen && archivedConversations.length > 0 ? (
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
              ) : undefined
            }
            renderRow={(conversation) => (
              <ChatRow
                conversation={conversation}
                state={state}
                isSelecting={isSelecting}
                isSelected={actions.selectedIds.includes(conversation.id)}
                onMenuAction={(action, anchor) => runMenuAction(conversation, action, anchor)}
                onSelect={() => {
                  if (isSelecting) {
                    actions.toggleSelection(conversation.id);
                    return;
                  }
                  selectChat(conversation.id);
                }}
              />
            )}
          />
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
                onAction={(action, anchor) => runMenuAction(conversation, action, anchor)}
              >
                <button
                  type="button"
                  className={styles.searchResult}
                  onClick={(event) => {
                    if (event.shiftKey) {
                      runMenuAction(
                        conversation,
                        'preview',
                        readPreviewAnchor(event.currentTarget),
                      );
                      return;
                    }
                    selectChat(conversation.id);
                  }}
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
        request={actions.preview}
        conversation={conversations.find(
          (conversation) => conversation.id === actions.preview?.chatId,
        )}
        state={state}
        onClose={actions.closePreview}
        onToggleRead={() => {
          const conversation = conversations.find((entry) => entry.id === actions.preview?.chatId);
          if (conversation) {
            actions.runMenuAction(conversation, 'read');
          }
        }}
      />
      <ConversationMuteDialog
        conversation={actions.muteConversation}
        onCancel={actions.cancelMute}
        onConfirm={actions.confirmMute}
      />
      <ConversationRemovalDialog
        request={actions.confirmation}
        onCancel={actions.cancelRemoval}
        onConfirm={actions.confirmRemoval}
      />
    </aside>
  );
}
