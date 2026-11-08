import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchResults } from './SearchResults';
import { SearchDateDialog } from './SearchDateDialog';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { describeMessage } from '../messageFormatting';
import type { Message } from '../model';
import styles from './ChatSearch.module.css';

interface ChatSearchProps {
  messages: Message[];
  canFilterSender: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void;
}

/** Search cached messages without replacing or remounting the conversation history. */
export function ChatSearch({ messages, canFilterSender, onClose, onJump }: ChatSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [senderId, setSenderId] = useState('');
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
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery && !senderId) {
      return [];
    }
    return messages
      .filter((message) => {
        const matchesSender = !senderId || message.authorId === senderId;
        const matchesText = describeMessage(message).toLowerCase().includes(normalizedQuery);
        return !message.isService && matchesSender && matchesText;
      })
      .reverse();
  }, [messages, query, senderId]);
  const activeIndex = results.findIndex((message) => message.id === activeId);
  const hasQuery = Boolean(query.trim() || senderId);
  const shouldShowResults = isFocused && (hasQuery || isChoosingSender);

  useEffect(() => {
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isChoosingDate) {
        onClose();
      }
    }
    document.addEventListener('keydown', closeFromKeyboard);
    return () => document.removeEventListener('keydown', closeFromKeyboard);
  }, [onClose, isChoosingDate]);

  function jumpToDate(timestamp: number) {
    const message = messages.find((entry) => entry.createdAt >= timestamp) ?? messages.at(-1);
    if (message) {
      chooseResult(message);
    }
  }

  function chooseResult(message: Message) {
    setActiveId(message.id);
    setIsFocused(false);
    inputRef.current?.blur();
    onJump(message.id);
  }

  function stepResult(direction: number) {
    const nextIndex = Math.max(0, Math.min(results.length - 1, activeIndex + direction));
    const message = results[nextIndex];
    if (message) {
      chooseResult(message);
    }
  }

  function clearSearch() {
    if (query) {
      setQuery('');
      setActiveId('');
      inputRef.current?.focus();
      return;
    }
    if (senderId || isChoosingSender) {
      setSenderId('');
      setIsChoosingSender(false);
      inputRef.current?.focus();
      return;
    }
    onClose();
  }

  return (
    <div className={styles.search}>
      <div className={styles.searchCard} data-focused={isFocused}>
        <div className={styles.inputRow}>
          <IconButton label="Close search" className={styles.mobileBack} onClick={onClose}>
            <ArrowLeft />
          </IconButton>
          <Search className={styles.searchIcon} size={20} />
          {senderId && (
            <span className={styles.sender}>
              {senders.find((sender) => sender.id === senderId)?.name}
            </span>
          )}
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
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                if (query && isFocused) {
                  inputRef.current?.blur();
                } else {
                  onClose();
                }
              }
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                stepResult(1);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                stepResult(-1);
              }
              if (event.key === 'Backspace' && !query) {
                setSenderId('');
                setIsChoosingSender(false);
              }
            }}
          />
          {results.length > 0 && (
            <div className={styles.navigation}>
              <IconButton
                label="Previous search result"
                disabled={activeIndex <= 0}
                onClick={() => stepResult(-1)}
              >
                <ChevronUp />
              </IconButton>
              <IconButton
                label="Next search result"
                disabled={activeIndex === results.length - 1}
                onClick={() => stepResult(1)}
              >
                <ChevronDown />
              </IconButton>
            </div>
          )}
          <IconButton label={hasQuery ? 'Clear search' : 'Close search'} onClick={clearSearch}>
            <X />
          </IconButton>
        </div>
        <div
          className={styles.resultsCollapse}
          data-open={shouldShowResults}
          inert={!shouldShowResults}
        >
          <div className={styles.results}>
            {isChoosingSender ? (
              senders.map((sender) => (
                <button
                  key={sender.id}
                  className={styles.result}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSenderId(sender.id);
                    setIsChoosingSender(false);
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                >
                  <Avatar initials={sender.name.slice(0, 1)} color="purple" size="small" />
                  <strong>{sender.name}</strong>
                  <Ripple />
                </button>
              ))
            ) : (
              <SearchResults
                key={`${query}:${senderId}`}
                messages={results}
                activeId={activeId}
                query={query}
                onSelect={chooseResult}
              />
            )}
            {hasQuery && !isChoosingSender && results.length === 0 && (
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
