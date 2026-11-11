import { useMemo, useState } from 'react';
import { ApiError, isCancelled } from '@/features/auth/SessionOwner';
import { renderMessage } from '../data/messageModels';
import { MessageSearchStatus } from './MessageSearchStatus';
import { SearchResults } from './SearchResults';
import { useMessageSearch, type LoadMessageSearchPage } from './useMessageSearch';
import styles from './ChatSearch.module.css';

const MIN_GLOBAL_QUERY_SCALARS = 3;

interface GlobalMessageSearchProps {
  query: string;
  visibilityKey: string;
  loadPage: LoadMessageSearchPage;
  onSelect: (selection: { conversationId: string; messageId: string }) => Promise<void>;
}

/** Present authorized message results below the connected conversation directory matches. */
export function GlobalMessageSearch(props: GlobalMessageSearchProps) {
  const query = props.query.trim().normalize('NFC');
  const canSearch = Array.from(query).length >= MIN_GLOBAL_QUERY_SCALARS;
  const [navigation, setNavigation] = useState<{
    query: string;
    error: string;
    unavailable: Set<string>;
  }>();
  const currentNavigation = navigation?.query === query ? navigation : undefined;
  const { page, error, isLoading, loadMore } = useMessageSearch({
    query: canSearch ? { query } : undefined,
    visibilityKey: props.visibilityKey,
    loadPage: props.loadPage,
  });
  const messages = useMemo(() => {
    if (!page) {
      return [];
    }

    const hits = page.hits.filter((message) => {
      return !currentNavigation?.unavailable.has(message.conversation_id);
    });
    return hits.map(renderMessage);
  }, [currentNavigation, page]);

  async function selectResult(selection: { conversationId: string; messageId: string }) {
    try {
      await props.onSelect(selection);
    } catch (failure) {
      if (isCancelled(failure)) {
        return;
      }

      setNavigation((previous) => {
        const unavailable = new Set(previous?.query === query ? previous.unavailable : []);
        const isMissing = failure instanceof ApiError && failure.code === 'not_found';
        if (isMissing) {
          unavailable.add(selection.conversationId);
        }

        const error = isMissing ? 'Message unavailable' : 'Could not open the message';
        return { query, error, unavailable };
      });
    }
  }

  if (!query) {
    return null;
  }

  return (
    <section aria-label="Messages matching your search">
      {!canSearch && (
        <p className={styles.empty}>Enter at least three characters to find messages.</p>
      )}
      {canSearch && (
        <>
          <SearchResults
            messages={messages}
            activeId=""
            query={query}
            onSelect={(message) => {
              void selectResult({ conversationId: message.chatId, messageId: message.id });
            }}
          />
          {currentNavigation && <p role="alert">{currentNavigation.error}</p>}
          <MessageSearchStatus
            page={page}
            error={error}
            isLoading={isLoading}
            onLoadMore={() => void loadMore()}
          />
        </>
      )}
    </section>
  );
}
