import { ArrowLeft, Search, Video } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
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
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <ChatHeaderFrame
      title={conversation.title}
      subtitle={conversation.subtitle}
      avatar={<Avatar initials={conversation.initials} color={conversation.color} size="small" />}
      isSearchOpen={isSearchOpen}
      searchButtonRef={searchButtonRef}
      pinnedCount={pinnedCount}
      onBack={onBack}
      onOpenDetails={onOpenDetails}
      actions={
        <>
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
        </>
      }
      search={
        <ChatSearch
          messages={messages}
          canFilterSender={conversation.kind === 'group'}
          onClose={onToggleSearch}
          onJump={onSearchJump}
        />
      }
    />
  );
}

interface ChatHeaderFrameProps {
  title: string;
  subtitle: string;
  avatar?: ReactNode;
  actions: ReactNode;
  search?: ReactNode;
  canRestoreSearchFocus?: boolean;
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  isSearchOpen?: boolean;
  pinnedCount?: number;
  detailsLabel?: string;
  backLabel?: string;
  onOpenDetails?: (trigger: HTMLButtonElement) => void;
  onBack: () => void;
}

/** Present a floating header around the identity, authorized actions, and active search surface. */
export function ChatHeaderFrame({
  title,
  subtitle,
  avatar,
  actions,
  search,
  searchButtonRef,
  canRestoreSearchFocus = true,
  isSearchOpen = false,
  pinnedCount,
  detailsLabel = 'Open chat information',
  backLabel = 'Back to chats',
  onOpenDetails,
  onBack,
}: ChatHeaderFrameProps) {
  const wasSearchOpenRef = useRef(isSearchOpen);
  useLayoutEffect(() => {
    // The actions must leave their inert state before the search trigger can receive focus.
    const active = document.activeElement;
    const header = searchButtonRef.current?.closest('header');
    const ownsFocus =
      header?.contains(active) || (active === document.body && canRestoreSearchFocus);
    if (wasSearchOpenRef.current && !isSearchOpen && ownsFocus) {
      searchButtonRef.current?.focus({ preventScroll: true });
    }
    wasSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen, searchButtonRef, canRestoreSearchFocus]);

  const shouldReduceMotion = useReducedMotion();
  const isPinnedView = pinnedCount !== undefined;
  const transition = {
    duration: shouldReduceMotion ? 0 : SEARCH_TRANSITION_DURATION,
    ease: 'easeInOut' as const,
  };
  const identity = (
    <>
      {avatar}
      <motion.span
        className={styles.identityText}
        animate={{ opacity: isSearchOpen ? 0 : 1 }}
        transition={transition}
      >
        <strong role="heading" aria-level={2}>
          {title}
        </strong>
        <span aria-live="polite">{subtitle}</span>
      </motion.span>
    </>
  );

  return (
    <div className={styles.headerStack}>
      <header
        className={styles.header}
        data-pinned-view={isPinnedView}
        data-search-open={isSearchOpen}
      >
        <IconButton
          label={isPinnedView ? 'Back to conversation' : backLabel}
          className={styles.backButton}
          onClick={onBack}
        >
          <ArrowLeft />
        </IconButton>
        {isPinnedView && (
          <div className={styles.pinnedTitle}>
            <strong>Pinned Messages</strong>
            <span>{pinnedCount === 1 ? '1 message' : `${pinnedCount} messages`}</span>
          </div>
        )}
        {!isPinnedView && onOpenDetails && (
          <button
            className={styles.identity}
            onClick={(event) => onOpenDetails(event.currentTarget)}
            aria-label={detailsLabel}
            disabled={isSearchOpen}
          >
            {identity}
          </button>
        )}
        {!isPinnedView && !onOpenDetails && <div className={styles.identity}>{identity}</div>}
        <motion.div
          className={styles.actions}
          animate={{ opacity: isSearchOpen ? 0 : 1 }}
          transition={transition}
          inert={isSearchOpen}
        >
          {actions}
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
              {search}
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </div>
  );
}
