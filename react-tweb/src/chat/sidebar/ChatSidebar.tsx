import { Archive, ArrowLeft, MoreVertical, Search, X } from 'lucide-react';
import { NewChatMenu, type NewChatMode } from './NewChatMenu';
import { NewChatPage } from './NewChatPage';
import type { ThemeOrigin } from '../../app/useThemeTransition';
import { useEffect, useRef, useState, type Dispatch } from 'react';
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
import { SidebarNavigation } from './SidebarNavigation';
import { SidebarPageHeader } from './SidebarPageHeader';
import { ArchiveMenu, type ArchiveMenuAction } from './ArchiveMenu';
import { ArchiveSettingsPage } from './ArchiveSettingsPage';
import { SettingsPage } from './SettingsPage';
import { ArchiveConfirmationDialog, ArchiveHelpDialog } from './ArchiveDialogs';
import { useArchiveActions } from './useArchiveActions';
import { useClosingDialogValue } from './useClosingDialogValue';
import styles from './ChatSidebar.module.css';

interface ChatSidebarProps {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: (origin?: ThemeOrigin) => void;
}

/** Display local conversations and switch to search without losing list position. */
export function ChatSidebar({ state, dispatch, onSelectChat, onToggleTheme }: ChatSidebarProps) {
  const [query, setQuery] = useState('');
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newChatMode, setNewChatMode] = useState<NewChatMode>();
  const [creationSession, setCreationSession] = useState(0);
  const closingNewChatMode = useClosingDialogValue(newChatMode);
  const conversations = useConversationList(state);
  const scrollOffsets = useRef({ inbox: 0, archive: 0 });
  const actions = useSidebarActions({ conversations, dispatch });
  const isSelecting = actions.selectedIds.length > 0;
  const archivedConversations = conversations.filter((conversation) => conversation.isArchived);
  const inboxConversations = conversations.filter((conversation) => !conversation.isArchived);
  const [isSearching, setIsSearching] = useState(false);
  const [searchScope, setSearchScope] = useState<'all' | 'archive'>('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const shouldFocusArchiveSearch = useRef(false);
  const archive = useArchiveActions({
    state,
    conversations: archivedConversations,
    dispatch,
    onSearch: openArchiveSearch,
  });
  let openSettingsPage: 'archive' | 'settings' | undefined;
  if (archive.isSettingsOpen) {
    openSettingsPage = 'archive';
  } else if (isSettingsOpen) {
    openSettingsPage = 'settings';
  }
  // Keep the outgoing page intact until the sidebar's slide-out transition has finished.
  const settingsPage = useClosingDialogValue(openSettingsPage);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingChats = conversations.filter((conversation) => {
    if (searchScope === 'archive' && !conversation.isArchived) {
      return false;
    }
    return conversation.title.toLowerCase().includes(normalizedQuery);
  });

  useEffect(() => {
    if (!isSearching && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false;
      menuButtonRef.current?.focus();
    }
  }, [isSearching]);

  useEffect(() => {
    if (!isSearching || !shouldFocusArchiveSearch.current) {
      return;
    }
    // Ark restores menu focus after selection; focus search after that restoration settles.
    const frame = requestAnimationFrame(() => {
      shouldFocusArchiveSearch.current = false;
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isSearching, isArchiveOpen]);

  function closeSearch() {
    shouldRestoreFocus.current = true;
    setIsSearching(false);
    setQuery('');
    setSearchScope('all');
  }

  function openArchiveSearch() {
    shouldFocusArchiveSearch.current = true;
    setIsArchiveOpen(false);
    setSearchScope('archive');
    setQuery('');
    setIsSearching(true);
  }

  function runArchiveAction(action: ArchiveMenuAction) {
    actions.clearSelection();
    archive.runAction(action);
  }

  function runMenuAction(
    conversation: ConversationListEntry,
    action: ConversationMenuAction,
    anchor?: PreviewAnchor,
  ) {
    if (action === 'select') {
      setIsSearching(false);
      setQuery('');
      setSearchScope('all');
      setIsArchiveOpen(conversation.isArchived);
    }
    actions.runMenuAction(conversation, action, anchor);
  }

  function selectChat(chatId: string) {
    setNewChatMode(undefined);
    setIsSearching(false);
    setQuery('');
    setSearchScope('all');
    onSelectChat(chatId);
  }

  function openArchive() {
    actions.clearSelection();
    setIsSearching(false);
    setQuery('');
    setSearchScope('all');
    setIsArchiveOpen(true);
  }

  function closeArchive() {
    actions.clearSelection();
    setIsArchiveOpen(false);
  }

  function renderConversationRow(conversation: ConversationListEntry) {
    return (
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
    );
  }

  const selectionToolbar = isSelecting ? (
    <SidebarSelectionToolbar
      conversations={actions.selectedConversations}
      onClear={actions.clearSelection}
      onUpdate={actions.applySelectionChanges}
      onDelete={actions.requestSelectionRemoval}
    />
  ) : undefined;

  const primaryPage = (
    <>
      <SidebarPageHeader selection={!isArchiveOpen ? selectionToolbar : undefined}>
        <div className={styles.header}>
          <SidebarMenu
            isSearching={isSearching}
            isDark={state.isDark}
            menuButtonRef={menuButtonRef}
            onCloseSearch={closeSearch}
            onSelectChat={selectChat}
            onToggleTheme={onToggleTheme}
            onOpenArchive={openArchive}
            onOpenSettings={() => setIsSettingsOpen(true)}
            archiveUnreadCount={archive.unreadCount}
          />
          <div className={styles.searchField} data-archive={searchScope === 'archive'}>
            <Search className={styles.searchIcon} size={24} aria-hidden="true" />
            {searchScope === 'archive' && (
              <button
                type="button"
                className={styles.archiveSearchScope}
                aria-label="Search all chats"
                onClick={() => setSearchScope('all')}
              >
                Archive <X size={14} />
              </button>
            )}
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
      </SidebarPageHeader>
      <div className={styles.content}>
        <div className={styles.conversationsPanel} inert={isSearching} aria-hidden={isSearching}>
          <VirtualConversationList
            conversations={inboxConversations}
            label="Conversations"
            initialOffset={scrollOffsets.current.inbox}
            onScrollOffsetChange={(offset) => {
              scrollOffsets.current.inbox = offset;
            }}
            onReorderPinned={(chatIds) =>
              dispatch({ type: 'reorder-pinned-conversations', chatIds })
            }
            archiveEntry={
              archive.isShownInChatList && archivedConversations.length > 0 ? (
                <ArchiveMenu
                  trigger="context"
                  isShownInChatList={archive.isShownInChatList}
                  hasUnread={archive.unreadCount > 0}
                  onAction={runArchiveAction}
                >
                  <button className={styles.archiveEntry} onClick={openArchive}>
                    <span className={styles.archiveAvatar}>
                      <Archive />
                    </span>
                    <span className={styles.rowContent}>
                      <strong>Archived Chats</strong>
                      <span>
                        {archivedConversations.map((conversation) => conversation.title).join(', ')}
                      </span>
                    </span>
                    {archive.unreadCount > 0 && (
                      <span className={styles.archiveCount}>{archive.unreadCount}</span>
                    )}
                    <Ripple />
                  </button>
                </ArchiveMenu>
              ) : undefined
            }
            renderRow={renderConversationRow}
          />
          <div className={styles.footer}>
            <NewChatMenu
              onChoose={(mode) => {
                setCreationSession((session) => session + 1);
                setNewChatMode(mode);
              }}
            />
          </div>
        </div>
        <nav
          className={styles.searchPanel}
          aria-label="Search results"
          aria-hidden={!isSearching}
          inert={!isSearching}
        >
          <div className={styles.searchCard}>
            <h2>{searchScope === 'archive' ? 'Archived Chats' : 'Chats'}</h2>
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
    </>
  );

  const archivePage = (
    <>
      <SidebarPageHeader selection={isArchiveOpen ? selectionToolbar : undefined}>
        <div className={styles.header}>
          <IconButton label="Back to conversations" onClick={closeArchive}>
            <ArrowLeft />
          </IconButton>
          <h2 className={styles.archiveTitle}>Archived Chats</h2>
          <ArchiveMenu
            trigger="button"
            isShownInChatList={archive.isShownInChatList}
            hasUnread={archive.unreadCount > 0}
            onAction={runArchiveAction}
          >
            <IconButton label="Archive options">
              <MoreVertical />
            </IconButton>
          </ArchiveMenu>
        </div>
      </SidebarPageHeader>
      <VirtualConversationList
        conversations={archivedConversations}
        label="Archived conversations"
        initialOffset={scrollOffsets.current.archive}
        onScrollOffsetChange={(offset) => {
          scrollOffsets.current.archive = offset;
        }}
        onReorderPinned={(chatIds) => dispatch({ type: 'reorder-pinned-conversations', chatIds })}
        renderRow={renderConversationRow}
      />
    </>
  );

  return (
    <aside
      className={styles.sidebar}
      aria-label="Chat list"
      data-searching={isSearching}
      data-selecting={isSelecting}
      onKeyDown={(event) => {
        if (event.defaultPrevented || archive.isHelpOpen || archive.confirmation) {
          return;
        }
        if (newChatMode && event.key === 'Escape') {
          event.preventDefault();
          setNewChatMode(undefined);
          return;
        }
        if (archive.isSettingsOpen && event.key === 'Escape') {
          event.preventDefault();
          archive.requestCloseSettings();
          return;
        }
        if (isSettingsOpen && event.key === 'Escape') {
          event.preventDefault();
          setIsSettingsOpen(false);
          return;
        }
        if (isSelecting && event.key === 'Escape') {
          event.preventDefault();
          actions.clearSelection();
          return;
        }
        if (isSearching && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
          return;
        }
        if (isArchiveOpen && event.key === 'Escape') {
          event.preventDefault();
          closeArchive();
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={Boolean(newChatMode)}
        secondary={
          closingNewChatMode && (
            <NewChatPage
              key={creationSession}
              mode={closingNewChatMode}
              conversations={conversations}
              dispatch={dispatch}
              onBack={() => setNewChatMode(undefined)}
              onSelectChat={selectChat}
            />
          )
        }
        primary={
          <SidebarNavigation
            isSecondaryOpen={archive.isSettingsOpen || isSettingsOpen}
            primary={
              <SidebarNavigation
                isSecondaryOpen={isArchiveOpen}
                primary={primaryPage}
                secondary={archivePage}
              />
            }
            secondary={
              settingsPage === 'archive' ? (
                <ArchiveSettingsPage
                  keepUnmutedArchived={archive.keepUnmutedArchived}
                  hasChanges={archive.hasSettingsChanges}
                  onChange={archive.changeSettings}
                  onBack={archive.requestCloseSettings}
                  onSave={archive.saveSettings}
                />
              ) : (
                <SettingsPage
                  isDark={state.isDark}
                  onToggleTheme={onToggleTheme}
                  onBack={() => setIsSettingsOpen(false)}
                />
              )
            }
          />
        }
      />
      <ArchiveHelpDialog
        isOpen={archive.isHelpOpen}
        keepUnmutedArchived={state.archivePreferences?.keepUnmutedArchived ?? false}
        onClose={archive.closeHelp}
        onOpenSettings={archive.openSettings}
      />
      <ArchiveConfirmationDialog
        confirmation={archive.confirmation}
        onCancel={archive.cancelConfirmation}
        onMarkAllAsRead={archive.markAllAsRead}
        onDiscard={archive.discardSettings}
        onSave={archive.saveSettings}
      />
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
