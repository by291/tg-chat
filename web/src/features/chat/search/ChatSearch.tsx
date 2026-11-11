import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { useIsPresent } from 'motion/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { SearchResults } from './SearchResults';
import { SearchDateDialog } from './SearchDateDialog';
import {
  SearchSenderList,
  SearchSenderPicker,
  type SearchSender,
  type SearchSenderRoster,
} from './SearchSenderPicker';
import { MessageSearchStatus } from './MessageSearchStatus';
import {
  useMessageSearch,
  type LoadMessageSearchPage,
  type SearchMessageKind,
} from './useMessageSearch';
import { renderMessage } from '../data/messageModels';
import { ApiError, isCancelled } from '@/features/auth/SessionOwner';
import { IconButton } from '@/components/IconButton';
import { describeMessage } from '../messageFormatting';
import type { Message } from '@/domain/messages/message';
import styles from './ChatSearch.module.css';

const IME_KEY_CODE = 229;

const MEDIA_KINDS: ReadonlyArray<{ kind: SearchMessageKind; label: string }> = [
  { kind: 'photo_video', label: 'Photos and videos' },
  { kind: 'file', label: 'Files' },
  { kind: 'voice', label: 'Voice messages' },
  { kind: 'link', label: 'Links' },
];

interface ConnectedSearchSource {
  conversationId: string;
  visibilityKey: string;
  loadPage: LoadMessageSearchPage;
  onJumpToDate: (timestamp: number) => Promise<void>;
  senderRoster?: SearchSenderRoster;
  senders?: SearchSender[];
}

interface ChatSearchProps {
  messages: Message[];
  canFilterSender: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void | Promise<void>;
  source?: ConnectedSearchSource;
}

function dayBoundary(value: string, options?: { isExclusiveEnd: boolean }): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (options?.isExclusiveEnd) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date.toISOString();
}

/** Search the conversation without replacing or remounting its timeline. */
export function ChatSearch(props: ChatSearchProps) {
  const { messages, canFilterSender, onClose, onJump, source } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const hasClosedRef = useRef(false);
  const isPresent = useIsPresent();
  const [query, setQuery] = useState('');
  const [sender, setSender] = useState<SearchSender>();
  const senderId = sender?.id ?? '';
  const [kind, setKind] = useState<SearchMessageKind>();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [navigationError, setNavigationError] = useState<{ key: string; message: string }>();
  const [isChoosingSender, setIsChoosingSender] = useState(false);
  const [isChoosingDate, setIsChoosingDate] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const [activeId, setActiveId] = useState('');
  const senders = useMemo(() => {
    const names = new Map<string, string>();
    for (const message of messages) {
      if (!message.isService) {
        names.set(message.authorId, message.authorName);
      }
    }
    return Array.from(names, ([id, name]) => ({ id, name }));
  }, [messages]);
  const localResults = useMemo(
    () => {
      const normalizedQuery = query.trim().toLowerCase();
      if (source || (!normalizedQuery && !senderId)) {
        return [];
      }

      return messages
        .filter((message) => {
          const matchesSender = !senderId || message.authorId === senderId;
          const matchesText = describeMessage(message).toLowerCase().includes(normalizedQuery);
          return !message.isService && matchesSender && matchesText;
        })
        .reverse();
    },
    // prettier-ignore
    [
      messages,
      query,
      senderId,
      source,
    ],
  );
  const text = query.trim().normalize('NFC');
  const visibilityKey = source?.visibilityKey ?? '';
  const requestKey = JSON.stringify({
    text,
    senderId,
    kind,
    dateFrom,
    dateTo,
    visibilityKey,
  });
  const error = navigationError?.key === requestKey ? navigationError.message : undefined;
  const hasInvertedDates = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const canQuery = source && !error && !hasInvertedDates && Boolean(text || kind) && isPresent;
  const remote = useMessageSearch({
    query: canQuery
      ? {
          query: text,
          conversation_id: source.conversationId,
          sender_id: senderId || undefined,
          kind,
          date_from: dayBoundary(dateFrom),
          date_to: dayBoundary(dateTo, { isExclusiveEnd: true }),
        }
      : undefined,
    loadPage: source?.loadPage,
    visibilityKey,
  });
  const results = source ? (remote.page?.hits.map(renderMessage) ?? []) : localResults;
  const activeIndex = results.findIndex((message) => message.id === activeId);
  const hasQuery = Boolean(text || kind || senderId);
  const shouldShowResults = isFocused && (hasQuery || isChoosingSender || Boolean(error));
  const closeSearch = useCallback(() => {
    // AnimatePresence keeps this mounted during exit; repeated Escape must not toggle it open.
    if (hasClosedRef.current) {
      return;
    }

    hasClosedRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    // Reopening during the exit animation reuses this instance instead of mounting a new one.
    if (isPresent) {
      hasClosedRef.current = false;
      inputRef.current?.focus();
    }
  }, [isPresent]);

  useEffect(() => {
    function closeFromKeyboard(event: KeyboardEvent) {
      const canClose =
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== IME_KEY_CODE &&
        !isChoosingDate;
      if (canClose) {
        event.preventDefault();
        closeSearch();
      }
    }
    document.addEventListener('keydown', closeFromKeyboard);

    return () => document.removeEventListener('keydown', closeFromKeyboard);
  }, [closeSearch, isChoosingDate]);

  function jumpToDate(timestamp: number) {
    if (source) {
      void source.onJumpToDate(timestamp).catch(showNavigationError);
      return;
    }

    const message = messages.find((entry) => entry.createdAt >= timestamp) ?? messages.at(-1);
    if (message) {
      chooseResult(message);
    }
  }

  function chooseResult(message: Message) {
    setActiveId(message.id);
    setIsFocused(false);
    inputRef.current?.blur();
    void Promise.resolve(onJump(message.id)).catch(showNavigationError);
  }

  function showNavigationError(failure: unknown) {
    if (isCancelled(failure)) {
      return;
    }
    const isMissing = failure instanceof ApiError && failure.code === 'not_found';
    const message = isMissing ? 'Message unavailable' : 'Could not open the message';
    setNavigationError({ key: requestKey, message });
    setIsFocused(true);
  }

  function stepResult(options: { direction: number; shouldConfirm: boolean }) {
    const { direction, shouldConfirm } = options;
    const nextIndex = Math.max(0, Math.min(results.length - 1, activeIndex + direction));
    const message = results[nextIndex];
    if (!message) {
      return;
    }
    if (shouldConfirm) {
      chooseResult(message);
    } else {
      setActiveId(message.id);
    }
  }

  function navigateFromInput(event: ReactKeyboardEvent<HTMLInputElement>) {
    const isComposing = event.nativeEvent.isComposing || event.keyCode === IME_KEY_CODE;
    if (event.defaultPrevented || isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (hasQuery && isFocused) {
        inputRef.current?.blur();
      } else {
        closeSearch();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const message = results[Math.max(0, activeIndex)];
      if (message) {
        chooseResult(message);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      stepResult({ direction: event.key === 'ArrowDown' ? 1 : -1, shouldConfirm: false });
      return;
    }
    if (event.key === 'Backspace' && !query) {
      setSender(undefined);
      setIsChoosingSender(false);
    }
  }

  function chooseSender(selected: SearchSender) {
    setSender(selected);
    setIsChoosingSender(false);
    if (!source) {
      setQuery('');
    }
    inputRef.current?.focus();
  }

  function clearSearch() {
    if (query) {
      setQuery('');
      setActiveId('');
      inputRef.current?.focus();
      return;
    }
    if (kind) {
      setKind(undefined);
      inputRef.current?.focus();
      return;
    }
    if (senderId || isChoosingSender) {
      setSender(undefined);
      setIsChoosingSender(false);
      inputRef.current?.focus();
      return;
    }

    closeSearch();
  }

  return (
    <div className={styles.search}>
      <div className={styles.searchCard} data-focused={isFocused}>
        <div className={styles.inputRow}>
          <IconButton label="Close search" className={styles.mobileBack} onClick={closeSearch}>
            <ArrowLeft />
          </IconButton>
          <Search className={styles.searchIcon} size={20} />
          {sender && <span className={styles.sender}>{sender.name}</span>}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            placeholder={isChoosingSender ? 'From:' : 'Search'}
            aria-label="Search in this conversation"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId('');
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={(event) => {
              if (
                !event.currentTarget.closest(`.${styles.searchCard}`)?.contains(event.relatedTarget)
              ) {
                setIsFocused(false);
              }
            }}
            onKeyDown={navigateFromInput}
          />
          {results.length > 0 && (
            <div className={styles.navigation}>
              <IconButton
                label="Previous search result"
                disabled={activeIndex <= 0}
                onClick={() => stepResult({ direction: -1, shouldConfirm: true })}
              >
                <ChevronUp />
              </IconButton>
              <IconButton
                label="Next search result"
                disabled={activeIndex === results.length - 1}
                onClick={() => stepResult({ direction: 1, shouldConfirm: true })}
              >
                <ChevronDown />
              </IconButton>
            </div>
          )}
          <IconButton label={hasQuery ? 'Clear search' : 'Close search'} onClick={clearSearch}>
            <X />
          </IconButton>
        </div>
        {source && isFocused && (
          <div className={styles.filters}>
            <label>
              Type
              <select
                value={kind ?? ''}
                onChange={(event) => {
                  const option = MEDIA_KINDS.find((entry) => entry.kind === event.target.value);
                  setKind(option?.kind);
                  setActiveId('');
                }}
              >
                <option value="">Any type</option>
                {MEDIA_KINDS.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From date
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              Through date
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
          </div>
        )}
        <div
          className={styles.resultsCollapse}
          data-open={shouldShowResults}
          inert={!shouldShowResults}
        >
          <div className={styles.results}>
            {isChoosingSender && source?.senderRoster && (
              <SearchSenderPicker
                key={`${visibilityKey}:${source.senderRoster.revision}`}
                conversationId={source.conversationId}
                loadPage={source.senderRoster.loadPage}
                onSelect={chooseSender}
              />
            )}
            {isChoosingSender && !source?.senderRoster && (
              <SearchSenderList senders={source?.senders ?? senders} onSelect={chooseSender} />
            )}
            {!isChoosingSender && (
              <SearchResults
                key={`${query}:${senderId}`}
                messages={results}
                activeId={activeId}
                query={query}
                onSelect={chooseResult}
              />
            )}
            {!isChoosingSender && source && senderId && !text && !kind && (
              <p className={styles.empty}>Enter text or choose a media type to search by sender.</p>
            )}
            {!isChoosingSender && source && (
              <MessageSearchStatus
                page={remote.page}
                error={
                  error ??
                  (hasInvertedDates ? 'Choose an end date after the start date.' : remote.error)
                }
                isLoading={remote.isLoading}
                onLoadMore={() => void remote.loadMore()}
              />
            )}
            {!source && hasQuery && !isChoosingSender && results.length === 0 && (
              <p className={styles.empty}>No messages found</p>
            )}
          </div>
        </div>
      </div>
      {canFilterSender && (
        <IconButton
          label="Search members"
          aria-pressed={isChoosingSender || Boolean(senderId)}
          onClick={() => {
            setIsChoosingSender(!isChoosingSender);
            setIsChoosingDate(false);
            inputRef.current?.focus();
          }}
        >
          <UserRound />
        </IconButton>
      )}
      <IconButton label="Jump to date" onClick={() => setIsChoosingDate(!isChoosingDate)}>
        <CalendarDays />
      </IconButton>
      <SearchDateDialog
        isOpen={isChoosingDate}
        onClose={() => setIsChoosingDate(false)}
        onSelect={jumpToDate}
      />
    </div>
  );
}
