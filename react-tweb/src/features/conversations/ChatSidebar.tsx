import { useAppNavigation } from '@/routes/useAppNavigation';
import type { NewChatMode } from './creation/NewChatMenu';
import { NewChatPage } from './creation/NewChatPage';
import type { ThemeOrigin } from '@/features/settings/appearance/useThemeTransition';
import { useRef, useState, type Dispatch } from 'react';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import { ConversationRemovalDialog } from './ConversationDialogs';
import { ConversationPreview } from './ConversationPreview';
import { ConversationMuteDialog } from './ConversationMuteDialog';
import type { PreviewAnchor } from './previewPosition';
import { SidebarSelectionToolbar } from './SidebarSelectionToolbar';
import { useSidebarActions } from './useSidebarActions';
import {
  useConversationList,
  type ConversationListEntry,
  type ConversationMenuAction,
} from './conversationList';
import { ChatRow } from './ChatRow';
import { SidebarMenu } from './SidebarMenu';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import { SidebarPageHeader } from './SidebarPageHeader';
import type { ArchiveMenuAction } from './archive/ArchiveMenu';
import { ArchiveSettingsPage } from './archive/ArchiveSettingsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ArchiveConfirmationDialog, ArchiveHelpDialog } from './archive/ArchiveDialogs';
import { useArchiveActions } from './archive/useArchiveActions';
import { useClosingDialogValue } from '@/hooks/useClosingDialogValue';
import { ArchivePage } from './archive/ArchivePage';
import { ConversationListPage } from './list/ConversationListPage';
import { SidebarSearchField } from './search/SidebarSearchField';
import { SidebarSearchResults } from './search/SidebarSearchResults';
import { useSidebarSearch } from './search/useSidebarSearch';
import styles from './ChatSidebar.module.css';

interface ChatSidebarProps {
  isDark?: boolean;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: (origin?: ThemeOrigin) => void;
}

/** Display local conversations and switch to search without losing list position. */
export function ChatSidebar({
  state,
  dispatch,
  onSelectChat,
  onToggleTheme,
  isDark = state.isDark,
}: ChatSidebarProps) {
  const navigation = useAppNavigation();
  const { isArchiveOpen, isSettingsOpen } = navigation;
  const [newChatMode, setNewChatMode] = useState<NewChatMode>();
  const [creationSession, setCreationSession] = useState(0);
  const closingNewChatMode = useClosingDialogValue(newChatMode);
  const conversations = useConversationList(state);
  const scrollOffsets = useRef({ inbox: 0, archive: 0 });
  const actions = useSidebarActions({ conversations, dispatch });
  const isSelecting = actions.selectedIds.length > 0;
  const archivedConversations = conversations.filter((conversation) => conversation.isArchived);
  const inboxConversations = conversations.filter((conversation) => !conversation.isArchived);
  const search = useSidebarSearch({
    conversations,
    isArchiveOpen,
    onCloseArchive: navigation.closeArchive,
  });
  const { isSearching } = search;
  const archive = useArchiveActions({
    state,
    conversations: archivedConversations,
    dispatch,
    onSearch: search.openArchiveSearch,
  });
  let openSettingsPage: 'archive' | 'settings' | undefined;
  if (archive.isSettingsOpen) {
    openSettingsPage = 'archive';
  } else if (isSettingsOpen) {
    openSettingsPage = 'settings';
  }
  // Keep the outgoing page intact until the sidebar's slide-out transition has finished.
  const settingsPage = useClosingDialogValue(openSettingsPage);

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
      search.resetSearch();
      if (conversation.isArchived) {
        navigation.openArchive();
      } else {
        navigation.closeArchive();
      }
    }
    actions.runMenuAction(conversation, action, anchor);
  }

  function selectChat(chatId: string) {
    setNewChatMode(undefined);
    search.resetSearch();
    onSelectChat(chatId);
  }

  function openArchive() {
    actions.clearSelection();
    search.resetSearch();
    navigation.openArchive();
  }

  function closeArchive() {
    actions.clearSelection();
    navigation.closeArchive();
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

  function reorderPinned(chatIds: string[]) {
    dispatch({ type: 'reorder-pinned-conversations', chatIds });
  }

  const primaryPage = (
    <ConversationListPage
      conversations={inboxConversations}
      archivedConversations={archivedConversations}
      isSearching={isSearching}
      isArchiveShown={archive.isShownInChatList}
      archiveUnreadCount={archive.unreadCount}
      initialOffset={scrollOffsets.current.inbox}
      onScrollOffsetChange={(offset) => {
        scrollOffsets.current.inbox = offset;
      }}
      onReorderPinned={reorderPinned}
      onOpenArchive={openArchive}
      onArchiveAction={runArchiveAction}
      onCreateChat={(mode) => {
        setCreationSession((session) => session + 1);
        setNewChatMode(mode);
      }}
      renderRow={renderConversationRow}
      header={
        <SidebarPageHeader selection={!isArchiveOpen ? selectionToolbar : undefined}>
          <div className={styles.header}>
            <SidebarMenu
              isSearching={isSearching}
              isDark={isDark}
              menuButtonRef={search.menuButtonRef}
              onCloseSearch={search.closeSearch}
              onSelectChat={selectChat}
              onToggleTheme={onToggleTheme}
              onOpenArchive={openArchive}
              onOpenSettings={() => navigation.openSettings()}
              archiveUnreadCount={archive.unreadCount}
            />
            <SidebarSearchField
              query={search.query}
              isArchiveScope={search.scope === 'archive'}
              inputRef={search.inputRef}
              onFocus={search.startSearch}
              onQueryChange={search.setQuery}
              onClearQuery={search.clearQuery}
              onSearchAllChats={search.searchAllChats}
            />
          </div>
        </SidebarPageHeader>
      }
      searchResults={
        <SidebarSearchResults
          conversations={search.matchingConversations}
          isSearching={isSearching}
          isArchiveScope={search.scope === 'archive'}
          onSelectChat={selectChat}
          onMenuAction={runMenuAction}
        />
      }
    />
  );

  const archivePage = (
    <ArchivePage
      conversations={archivedConversations}
      isShownInChatList={archive.isShownInChatList}
      hasUnread={archive.unreadCount > 0}
      initialOffset={scrollOffsets.current.archive}
      selection={isArchiveOpen ? selectionToolbar : undefined}
      onBack={closeArchive}
      onAction={runArchiveAction}
      onScrollOffsetChange={(offset) => {
        scrollOffsets.current.archive = offset;
      }}
      onReorderPinned={reorderPinned}
      renderRow={renderConversationRow}
    />
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
          navigation.closeSettings();
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
          search.closeSearch();
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
                  onBack={() => navigation.closeSettings()}
                  conversations={conversations}
                  onSetMuted={({ chatId, isMuted }) =>
                    dispatch({
                      type: 'update-conversations',
                      chatIds: [chatId],
                      changes: { isMuted, mutedUntil: 0 },
                    })
                  }
                  onResetMutes={() =>
                    dispatch({
                      type: 'update-conversations',
                      chatIds: conversations.map((entry) => entry.id),
                      changes: { isMuted: false, mutedUntil: 0 },
                    })
                  }
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
