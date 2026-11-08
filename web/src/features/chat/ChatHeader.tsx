import { ArrowLeft, Search, Video } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { ChatHeaderMenu, type HeaderAction } from './ChatHeaderMenu';
import { ChatSearch } from './search/ChatSearch';
import type { Conversation } from '@/domain/conversations/conversation';
import type { Message } from '@/domain/messages/message';
import styles from './ChatHeader.module.css';

const SEARCH_TRANSITION_DURATION = 0.2;

interface ChatHeaderProps {
  conversation: Conversation;
  messages: Message[];
  isSearchOpen: boolean;
  isSelecting: boolean;
  pinnedCount?: number;
  onToggleSearch: () => void;
  onSearchJump: (messageId: string) => void;
  onOpenDetails: () => void;
  onBack: () => void;
  onAction: (action: HeaderAction) => void;
  onAutoDelete: (days: number) => void;
}

/** Crossfade the identity and actions into in-place search while keeping the avatar stationary. */
export function ChatHeader({
  conversation,
  messages,
  isSearchOpen,
  isSelecting,
  pinnedCount,
  onToggleSearch,
  onSearchJump,
  onOpenDetails,
  onBack,
  onAction,
  onAutoDelete,
}: ChatHeaderProps) {
  const shouldReduceMotion = useReducedMotion();
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const wasSearchOpenRef = useRef(isSearchOpen);
  const isPinnedView = pinnedCount !== undefined;
  const transition = {
    duration: shouldReduceMotion ? 0 : SEARCH_TRANSITION_DURATION,
    ease: 'easeInOut' as const,
  };

  useLayoutEffect(() => {
    // The actions must leave their inert state before the search trigger can receive focus.
    if (wasSearchOpenRef.current && !isSearchOpen) {
      searchButtonRef.current?.focus({ preventScroll: true });
    }
    wasSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen]);

  return (
    <div className={styles.headerStack}>
      <header
        className={styles.header}
        data-pinned-view={isPinnedView}
        data-search-open={isSearchOpen}
      >
        <IconButton
          label={isPinnedView ? 'Back to conversation' : 'Back to chats'}
          className={styles.backButton}
          onClick={onBack}
        >
          <ArrowLeft />
        </IconButton>
        {isPinnedView ? (
          <div className={styles.pinnedTitle}>
            <strong>Pinned Messages</strong>
            <span>{pinnedCount === 1 ? '1 message' : `${pinnedCount} messages`}</span>
          </div>
        ) : (
          <button
            className={styles.identity}
            onClick={onOpenDetails}
            aria-label="Open chat information"
            disabled={isSearchOpen}
          >
            <Avatar initials={conversation.initials} color={conversation.color} size="small" />
            <motion.span
              className={styles.identityText}
              animate={{ opacity: isSearchOpen ? 0 : 1 }}
              transition={transition}
            >
              <strong>{conversation.title}</strong>
              <span>{conversation.subtitle}</span>
            </motion.span>
          </button>
        )}
        <motion.div
          className={styles.actions}
          animate={{ opacity: isSearchOpen ? 0 : 1 }}
          transition={transition}
          inert={isSearchOpen}
        >
          {conversation.kind === 'group' && (
            <IconButton
              label="Video chat"
              className={`${styles.utilityButton} ${styles.searchButton}`}
              onClick={() => onAction('call')}
            >
              <Video />
            </IconButton>
          )}
          <IconButton
            ref={searchButtonRef}
            label="Search messages"
            className={`${styles.utilityButton} ${styles.searchButton}`}
            onClick={onToggleSearch}
          >
            <Search />
          </IconButton>
          <ChatHeaderMenu
            conversation={conversation}
            isSelecting={isSelecting}
            onSearch={onToggleSearch}
            onAction={onAction}
            onAutoDelete={onAutoDelete}
          />
        </motion.div>
        <AnimatePresence>
          {isSearchOpen && (
            <motion.div
              className={styles.searchLayer}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              <ChatSearch
                messages={messages}
                canFilterSender={conversation.kind === 'group'}
                onClose={onToggleSearch}
                onJump={onSearchJump}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </div>
  );
}
