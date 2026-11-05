import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import {
  BadgeCheck,
  Bookmark,
  CheckCheck,
  Menu as MenuIcon,
  Moon,
  Pencil,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { conversations } from '../demo/fixtures';
import { describeMessage, formatMessageTime } from '../messageFormatting';
import type { ChatState, Conversation } from '../model';
import styles from './ChatSidebar.module.css';
import overlays from '../overlays.module.css';

interface ChatSidebarProps {
  state: ChatState;
  onSelectChat: (chatId: string) => void;
  onToggleTheme: () => void;
}

interface ChatRowProps {
  conversation: Conversation;
  state: ChatState;
  onSelect: () => void;
}

function ChatRow({ conversation, state, onSelect }: ChatRowProps) {
  const messages = state.messages.filter((message) => message.chatId === conversation.id);
  const lastMessage = messages.at(-1);
  const draft = state.drafts[conversation.id];
  const isActive = state.activeChatId === conversation.id;
  const preview = lastMessage ? describeMessage(lastMessage) : conversation.preview;
  const time = lastMessage ? formatMessageTime(lastMessage.createdAt) : conversation.time;

  return (
    <button className={styles.chatRow} data-active={isActive} onClick={onSelect}>
      <Avatar initials={conversation.initials} color={conversation.color} />
      <span className={styles.rowContent}>
        <span className={styles.rowHeading}>
          <span className={styles.chatTitle}>{conversation.title}</span>
          {conversation.isVerified && <BadgeCheck className={styles.verified} size={17} />}
          <span className={styles.chatTime}>
            {lastMessage?.authorId === 'you' && <CheckCheck size={16} />}
            {time}
          </span>
        </span>
        <span className={styles.rowPreview}>
          <span className={styles.previewText}>
            {draft && <span className={styles.draftLabel}>Draft: </span>}
            {draft || preview}
          </span>
          {conversation.unreadCount && !isActive && (
            <span className={styles.unread} data-muted={conversation.isMuted}>
              {conversation.unreadCount}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** Display the searchable conversation list and account-level presentation controls. */
export function ChatSidebar({ state, onSelectChat, onToggleTheme }: ChatSidebarProps) {
  const [query, setQuery] = useState('');
  const matchingChats = conversations.filter((conversation) => {
    return conversation.title.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <aside className={styles.sidebar} aria-label="Chat list">
      <div className={styles.header}>
        <Menu.Root positioning={{ placement: 'bottom-start' }}>
          <Menu.Trigger asChild>
            <IconButton label="Main menu">
              <MenuIcon />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content className={overlays.menu}>
                <Menu.Item
                  value="saved"
                  className={overlays.menuItem}
                  onSelect={() => onSelectChat('saved')}
                >
                  <Bookmark /> Saved Messages
                </Menu.Item>
                <Menu.Item value="theme" className={overlays.menuItem} onSelect={onToggleTheme}>
                  <Moon /> {state.isDark ? 'Light mode' : 'Dark mode'}
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
        <label className={styles.searchField}>
          <Search size={21} />
          <input
            aria-label="Search conversations"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <nav className={styles.chatList} aria-label="Conversations">
        {matchingChats.map((conversation) => (
          <ChatRow
            key={conversation.id}
            conversation={conversation}
            state={state}
            onSelect={() => onSelectChat(conversation.id)}
          />
        ))}
        {matchingChats.length === 0 && <p className={styles.empty}>No conversations found</p>}
      </nav>
      <div className={styles.footer}>
        <span className={styles.localBadge}>
          <span /> Local demo
        </span>
        <IconButton
          label="Open dev conversation"
          className={styles.composeButton}
          onClick={() => onSelectChat('dev')}
        >
          <Pencil />
        </IconButton>
      </div>
    </aside>
  );
}
