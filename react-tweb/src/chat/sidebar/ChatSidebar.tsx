import { Pencil, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import { conversations } from '../demo/fixtures';
import type { ChatState } from '../model';
import { ChatRow } from './ChatRow';
import { SidebarMenu } from './SidebarMenu';
import styles from './ChatSidebar.module.css';

interface ChatSidebarProps {
  state: ChatState;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: () => void;
}

/** Display local conversations and switch to search without losing list position. */
export function ChatSidebar({ state, onSelectChat, onToggleTheme }: ChatSidebarProps) {
  const [query, setQuery] = useState('');
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
        if (isSearching && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }
      }}
    >
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
      <div className={styles.content}>
        <div className={styles.conversationsPanel} inert={isSearching} aria-hidden={isSearching}>
          <nav className={styles.chatList} aria-label="Conversations">
            {conversations.map((conversation) => (
              <ChatRow
                key={conversation.id}
                conversation={conversation}
                state={state}
                onSelect={() => selectChat(conversation.id)}
              />
            ))}
          </nav>
          <div className={styles.footer}>
            <span className={styles.localBadge}>
              <span /> Local demo
            </span>
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
              <button
                key={conversation.id}
                type="button"
                className={styles.searchResult}
                onClick={() => selectChat(conversation.id)}
              >
                <Avatar initials={conversation.initials} color={conversation.color} size="small" />
                <span className={styles.rowContent}>
                  <span className={styles.resultTitle}>{conversation.title}</span>
                  <span className={styles.resultSubtitle}>{conversation.subtitle}</span>
                </span>
                <Ripple />
              </button>
            ))}
            {matchingChats.length === 0 && <p className={styles.empty}>No conversations found</p>}
          </div>
        </nav>
      </div>
    </aside>
  );
}
