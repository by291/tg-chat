import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { IconButton } from '@/components/IconButton';
import { createHistoryRows } from './historyRows';
import { MessageBubble } from '../messages/MessageBubble';
import { DeferredMessageMedia } from '../messages/content/media/deferredMedia';
import { MessageMenu } from '../messages/menu/MessageMenu';
import { StructuredMessageActionsProvider } from '../messages/StructuredMessageActions';
import {
  useMessageSelectionGesture,
  type MessageSelectionChange,
} from '../messages/selection/useMessageSelectionGesture';
import { useMessageMenu } from '../messages/menu/useMessageMenu';
import { findMessageRow } from '../messages/selection/messageRowTarget';
import { describeMessage } from '../messageFormatting';
import type { Message } from '@/domain/messages/message';
import type { MessageCommand } from '@/features/chat/messages/commands';
import type { MessageInteraction } from '@/domain/messages/interaction';
import { useHistoryWindow, type RemoteHistory } from './useHistoryWindow';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
import { useVirtualHistory } from './useVirtualHistory';
import { StickyDateHeaders } from './StickyDateHeaders';
import { createHistoryDateGroups } from './historyDates';
import { createHistorySenderGroups } from './historySenderGroups';
import { StickySenderAvatars } from './StickySenderAvatars';
import { registerReactionLayoutHistory } from '../messages/reactions/reactionLayoutTransition';
import { SearchDateDialog } from '../search/SearchDateDialog';
import type { ChatOverlayInsets } from '../useChatOverlayInsets';
import type { OutgoingMessageMount } from '../messages/transitions/outgoingMessageTransition';
import styles from './MessageTimeline.module.css';

const HIGHLIGHT_DURATION = 1800;

export interface MessageNavigation {
  messageId: string;
  requestId: number;
  kind?: 'unread';
}

interface MessageTimelineProps {
  allowedActions?: import('../messages/commands').MessageMenuAction[];
  reactionChoices?: string[];
  onMessageMount?: (options: OutgoingMessageMount) => (() => void) | undefined;
  messages: Message[];
  shouldShowSender?: boolean;
  overlayInsets?: ChatOverlayInsets;
  isPreview?: boolean;
  canUseMessageActions?: boolean;
  remoteHistory?: RemoteHistory;
  precedingMessage?: Message;
  messageIdPrefix?: string;
  searchQuery: string;
  firstUnreadMessageId?: string;
  unreadCount?: number;
  isMuted?: boolean;
  onReachLatest?: (messageId: string) => void;
  onReachMessage?: (messageId: string) => void;
  navigation?: MessageNavigation;
  latestRequest?: number;
  selectedIds?: string[];
  onToggleSelection?: (messageId: string) => void;
  onSetSelection?: (change: MessageSelectionChange) => void;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
  onInteract: (messageId: string, interaction: MessageInteraction) => void | Promise<boolean>;
  onOpenMedia: (message: Message) => void;
  onJumpToMessage: (messageId: string) => void;
}

interface VirtualMessageHistoryProps extends MessageTimelineProps {
  messageById: Map<string, Message>;
}

function VirtualMessageHistory({
  allowedActions,
  reactionChoices,
  messages,
  shouldShowSender,
  onMessageMount,
  overlayInsets,
  messageById,
  searchQuery,
  firstUnreadMessageId,
  unreadCount = 0,
  isMuted = false,
  onReachLatest,
  onReachMessage,
  navigation,
  latestRequest,
  selectedIds,
  onToggleSelection,
  onSetSelection,
  isPreview,
  canUseMessageActions = true,
  remoteHistory,
  precedingMessage,
  messageIdPrefix,
  onCommand,
  onReact,
  onInteract,
  onOpenMedia,
  onJumpToMessage,
}: VirtualMessageHistoryProps) {
  const currentUserId = useCurrentUserId();
  const unreadNavigationId = navigation?.kind === 'unread' ? navigation.messageId : undefined;
  const unreadId = unreadNavigationId ?? firstUnreadMessageId;
  const unreadMessage = unreadId ? messageById.get(unreadId) : undefined;
  const canShowUnread = !searchQuery && !isPreview && unreadMessage && !unreadMessage.isService;
  const dividerId =
    canShowUnread && unreadMessage.authorId !== currentUserId ? unreadId : undefined;
  const allRows = useMemo(
    () => createHistoryRows(messages, { precedingMessage, firstUnreadMessageId: dividerId }),
    [messages, precedingMessage, dividerId],
  );
  const [highlightedId, setHighlightedId] = useState('');
  const [calendarRequest, setCalendarRequest] = useState({ timestamp: Date.now(), id: 0 });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const history = useHistoryWindow(allRows, remoteHistory);
  const { rows, hasOlder, loadOlder } = history;
  const notifyMessageMount = isPreview ? undefined : onMessageMount;
  const scroll = useVirtualHistory({
    rows,
    overlayInsets,
    hasOlder,
    loadOlder,
    remoteHistory,
    navigation,
    latestRequest,
    onReachLatest,
    onReachMessage: searchQuery || isPreview ? undefined : onReachMessage,
  });
  useLayoutEffect(
    () => {
      const viewport = scroll.viewportRef.current;
      if (!viewport) {
        return;
      }

      return registerReactionLayoutHistory({
        viewport,
        measureRow: (row) => {
          if (!(row instanceof HTMLDivElement)) {
            return;
          }

          const index = scroll.virtualizer.indexFromElement(row);
          // measureElement defers reads during user scrolling. A local reaction needs its final
          // size now, before presentation snapshots, while TanStack still owns the actual layout.
          scroll.virtualizer.resizeItem(index, row.getBoundingClientRect().height);
        },
        scrollToEnd: () => scroll.virtualizer.scrollToEnd({ behavior: 'auto' }),
      });
    },
    // prettier-ignore
    [
      scroll.viewportRef,
      scroll.virtualizer,
      registerReactionLayoutHistory,
    ],
  );
  const menu = useMessageMenu({
    viewportRef: scroll.viewportRef,
    isDisabled: isPreview || !canUseMessageActions,
    selectedIds,
    onSelectMessage: (messageId) => {
      const message = messageById.get(messageId);
      if (message) {
        onCommand({ action: 'select', message });
      }
    },
  });
  const selectionGesture = useMessageSelectionGesture({
    messages,
    selectedIds,
    isDisabled: isPreview || !canUseMessageActions || menu.isOpen,
    onToggleSelection,
    onSetSelection,
  });
  const virtualItems = scroll.virtualizer.getVirtualItems();
  const totalHeight = scroll.virtualizer.getTotalSize();
  const viewportHeight = scroll.virtualizer.scrollRect?.height || 0;
  const bottomAlignment = Math.max(0, viewportHeight - totalHeight);
  const dateGroups = createHistoryDateGroups({
    rows,
    measurements: scroll.virtualizer.measurementsCache,
    renderedItems: virtualItems,
    bottomAlignment,
  });
  const senderGroups = shouldShowSender
    ? createHistorySenderGroups({
        rows,
        measurements: scroll.virtualizer.measurementsCache,
        renderedItems: virtualItems,
        bottomAlignment,
        currentUserId,
      })
    : [];
  const canJumpToLatest = scroll.canJumpToLatest || remoteHistory?.hasNewer || unreadCount > 0;
  const isJumpVisible = canJumpToLatest && !searchQuery;
  const unreadNoun = unreadCount === 1 ? 'message' : 'messages';
  const jumpLabel =
    unreadCount > 0
      ? `Jump to latest message, ${unreadCount} unread ${unreadNoun}`
      : 'Jump to latest message';

  useEffect(() => {
    if (!navigation) {
      return;
    }

    history.revealMessage(navigation.messageId);
    if (navigation.kind === 'unread') {
      setHighlightedId('');
      return;
    }

    setHighlightedId(navigation.messageId);
    const timeout = window.setTimeout(() => setHighlightedId(''), HIGHLIGHT_DURATION);

    return () => window.clearTimeout(timeout);
  }, [navigation]);

  function openDatePicker(timestamp: number) {
    if (!canUseMessageActions) {
      return;
    }
    setCalendarRequest((previous) => ({ timestamp, id: previous.id + 1 }));
    setIsCalendarOpen(true);
  }

  function replyToRow(event: MouseEvent<HTMLDivElement>) {
    const isDisabled = isPreview || !canUseMessageActions || selectedIds !== undefined;
    if (isDisabled || !(event.target instanceof Element)) {
      return;
    }

    const isInteractiveContent = event.target.closest(
      'button, a, input, video, audio, [data-message-media], [data-message-metadata]',
    );
    if (isInteractiveContent || window.getSelection()?.toString().trim()) {
      return;
    }

    const messageId = findMessageRow(event.target)?.dataset.messageId;
    const message = messageId ? messageById.get(messageId) : undefined;
    if (message) {
      onCommand({ action: 'reply', message });
    }
  }

  return (
    <DeferredMessageMedia isDeferred={scroll.isNavigating}>
      <div
        ref={scroll.viewportRef}
        className={styles.viewport}
        onScroll={scroll.updateScrollPosition}
        onWheel={scroll.cancelAutomaticScroll}
        onTouchStart={scroll.cancelAutomaticScroll}
        onPointerDown={scroll.cancelAutomaticScroll}
        onKeyDown={(event) => {
          scroll.cancelAutomaticScroll();
          menu.onKeyDown(event);
        }}
        onContextMenu={menu.onContextMenu}
        onDoubleClick={replyToRow}
        onClickCapture={(event) => {
          menu.onClick(event);
          if (!event.defaultPrevented) {
            selectionGesture.onClick(event);
          }
        }}
        onPointerDownCapture={(event) => {
          menu.onPointerDown(event);
          selectionGesture.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          menu.onPointerMove(event);
          selectionGesture.onPointerMove(event);
        }}
        onPointerUp={menu.cancelLongPress}
        onPointerCancel={menu.cancelLongPress}
        aria-label="Message history"
        data-total-rows={allRows.length}
        data-loaded-rows={rows.length}
        data-rendered-rows={virtualItems.length}
        tabIndex={0}
      >
        <div
          ref={scroll.contentRef}
          className={styles.messages}
          style={{ height: totalHeight + bottomAlignment }}
        >
          <div ref={scroll.animatedRowsRef} className={styles.animatedRows} data-history-rows>
            <StickyDateHeaders
              groups={dateGroups}
              viewportRef={scroll.viewportRef}
              topInset={overlayInsets?.top ?? 0}
              isPreview={Boolean(isPreview)}
              onOpenDate={openDatePicker}
            />
            <StickySenderAvatars
              groups={senderGroups}
              isSelecting={selectedIds !== undefined}
              isPreview={Boolean(isPreview)}
            />
            {virtualItems.map((item) => {
              const row = rows[item.index];
              const isMessageRow = row.kind === 'message' && !row.message.isService;
              return (
                <div
                  key={row.key}
                  ref={scroll.virtualizer.measureElement}
                  data-index={item.index}
                  data-row-key={row.key}
                  data-message-id={isMessageRow ? row.key : undefined}
                  role={isMessageRow ? 'group' : undefined}
                  aria-label={isMessageRow ? `Message: ${describeMessage(row.message)}` : undefined}
                  tabIndex={isMessageRow && !isPreview ? 0 : undefined}
                  data-menu-open={menu.isOpen && menu.target?.messageId === row.key}
                  data-selected={selectedIds?.includes(row.key)}
                  className={styles.virtualRow}
                  inert={isPreview}
                  style={{ transform: `translateY(${item.start + bottomAlignment}px)` }}
                >
                  <div className={styles.rowContent} data-message-row-content>
                    {row.kind === 'date' && <div className={styles.dateSpace} aria-hidden="true" />}
                    {row.kind === 'message' && (
                      <MessageBubble
                        message={row.message}
                        shouldShowSender={shouldShowSender}
                        onMount={notifyMessageMount}
                        isSelecting={selectedIds !== undefined}
                        isSelected={selectedIds?.includes(row.message.id)}
                        isPreview={isPreview}
                        idPrefix={messageIdPrefix}
                        replyMessage={messageById.get(row.message.replyToId || '')}
                        isGroupStart={row.isGroupStart}
                        isGroupEnd={row.isGroupEnd}
                        isHighlighted={row.key === highlightedId}
                        onReact={onReact}
                        onInteract={onInteract}
                        onOpenMedia={onOpenMedia}
                        onJumpToMessage={onJumpToMessage}
                      />
                    )}
                  </div>
                  {row.kind === 'unread' && (
                    <div
                      className={styles.unreadDivider}
                      role="separator"
                      aria-label="Unread messages"
                    >
                      Unread messages
                    </div>
                  )}
                </div>
              );
            })}
            {messages.length === 0 && (
              <div className={styles.emptyState}>
                <strong>{searchQuery ? 'No messages found' : 'A fresh conversation'}</strong>
                <p>
                  {searchQuery ? 'Try another word or phrase.' : 'Send a message to get started.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {!isPreview && canUseMessageActions && (
        <SearchDateDialog
          key={calendarRequest.id}
          isOpen={isCalendarOpen}
          initialDate={calendarRequest.timestamp}
          onClose={() => setIsCalendarOpen(false)}
          onSelect={(timestamp) => {
            const message =
              messages.find((entry) => entry.createdAt >= timestamp) ?? messages.at(-1);
            if (message) {
              onJumpToMessage(message.id);
            }
          }}
        />
      )}
      {!isPreview && canUseMessageActions && (
        <MessageMenu
          allowedActions={allowedActions}
          reactionChoices={reactionChoices}
          contentId={menu.contentId}
          target={menu.target}
          message={menu.target ? messageById.get(menu.target.messageId) : undefined}
          selectedMessages={
            menu.target?.selectedIds
              ? messages.filter((message) => menu.target?.selectedIds?.includes(message.id))
              : undefined
          }
          isOpen={menu.isOpen}
          onClose={menu.closeMenu}
          onExitComplete={menu.releaseTarget}
          onCommand={onCommand}
          onReact={onReact}
        />
      )}
      {!isPreview && (
        <IconButton
          label={jumpLabel}
          className={styles.jumpButton}
          data-visible={isJumpVisible}
          aria-hidden={!isJumpVisible}
          tabIndex={isJumpVisible ? 0 : -1}
          onClick={() => void scroll.jumpToLatest()}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M19.5869 12.5869C19.9111 12.2628 19.9111 11.7372 19.5869 11.4131C19.2628 11.089 18.7372 11.089 18.4131 11.4131L12.8301 16.9961L12.8301 5C12.8301 4.5416 12.4584 4.16992 12 4.16992C11.5416 4.16996 11.1699 4.54163 11.1699 5L11.1699 16.9961L5.58692 11.4131C5.26278 11.089 4.73721 11.089 4.41309 11.4131C4.08899 11.7372 4.08899 12.2628 4.41309 12.5869L11.4131 19.5869C11.5687 19.7426 11.7799 19.8301 12 19.8301C12.2201 19.8301 12.4313 19.7425 12.5869 19.5869L19.5869 12.5869Z"
            />
          </svg>
          {unreadCount > 0 && (
            <span className={styles.unreadBadge} data-muted={isMuted} aria-hidden="true">
              {unreadCount.toLocaleString('en-US')}
            </span>
          )}
        </IconButton>
      )}
    </DeferredMessageMedia>
  );
}

/** Keep a bounded message DOM while preserving grouping and message-ID navigation. */
export const MessageTimeline = memo(function MessageTimeline(props: MessageTimelineProps) {
  const normalizedQuery = props.searchQuery.trim().toLowerCase();
  const messageById = useMemo(() => {
    return new Map(props.messages.map((message) => [message.id, message]));
  }, [props.messages]);
  const visibleMessages = useMemo(() => {
    if (!normalizedQuery) {
      return props.messages;
    }
    return props.messages.filter((message) => {
      return describeMessage(message).toLowerCase().includes(normalizedQuery);
    });
  }, [props.messages, normalizedQuery]);

  return (
    <div
      className={styles.timelineArea}
      data-preview={props.isPreview}
      data-floating-controls={Boolean(props.overlayInsets)}
      style={
        {
          '--history-top-inset': `${props.overlayInsets?.top ?? 0}px`,
          '--history-bottom-inset': `${props.overlayInsets?.bottom ?? 0}px`,
        } as CSSProperties
      }
    >
      <StructuredMessageActionsProvider key={normalizedQuery}>
        <VirtualMessageHistory
          {...props}
          messages={visibleMessages}
          messageById={messageById}
          searchQuery={normalizedQuery}
        />
      </StructuredMessageActionsProvider>
    </div>
  );
});
