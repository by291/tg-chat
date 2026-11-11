import { useEffect, useMemo, useRef, useState } from 'react';
import { isCancelled } from '@/features/auth/SessionOwner';
import type { components, paths } from '@/api/schema';

const SEARCH_DELAY_MS = 180;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type SearchMessageKind = components['schemas']['MessageKind'];
export type MessageSearchPage = components['schemas']['SearchPage'];
type SearchParameters = paths['/api/v1/chat/search']['get']['parameters']['query'];
type MessageSearchQuery = NonNullable<SearchParameters> & { query: string };

export type LoadMessageSearchPage = (input: {
  query: MessageSearchQuery;
  signal: AbortSignal;
}) => Promise<MessageSearchPage>;

interface SearchState {
  query: MessageSearchQuery;
  visibilityKey: string;
  page?: MessageSearchPage;
  error?: string;
  isLoading: boolean;
}

interface SearchRequest {
  controller: AbortController;
  isLoadingMore: boolean;
}

interface SearchOptions {
  query?: MessageSearchQuery;
  loadPage?: LoadMessageSearchPage;
  visibilityKey: string;
}

function includePage(previous: MessageSearchPage, next: MessageSearchPage): MessageSearchPage {
  const hits = new Map(previous.hits.map((message) => [message.id, message]));
  for (const message of next.hits) {
    hits.set(message.id, message);
  }

  return { ...next, hits: Array.from(hits.values()) };
}

function messageSearchError(failure: unknown): string | undefined {
  if (isCancelled(failure)) {
    return undefined;
  }

  return failure instanceof Error ? failure.message : 'Search is temporarily unavailable.';
}

/** Debounce queries and discard results when the account's visibility changes. */
export function useMessageSearch(options: SearchOptions) {
  const { loadPage, visibilityKey } = options;
  const {
    query: text,
    conversation_id: conversationId,
    sender_id: senderId,
    date_from: dateFrom,
    date_to: dateTo,
    kind,
  } = options.query ?? {};
  const query = useMemo(() => {
    if (text === undefined) {
      return undefined;
    }

    return {
      query: text,
      ...(conversationId && { conversation_id: conversationId }),
      ...(senderId && { sender_id: senderId }),
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
      ...(kind && { kind }),
    };
  }, [text, conversationId, senderId, dateFrom, dateTo, kind]);
  const requestRef = useRef<SearchRequest>(undefined);
  const [state, setState] = useState<SearchState>();
  const [expiryRevision, setExpiryRevision] = useState(0);
  const current =
    state?.query === query && state?.visibilityKey === visibilityKey ? state : undefined;
  const page = current?.page;

  useEffect(() => {
    if (!query || !loadPage) {
      return;
    }

    const controller = new AbortController();
    requestRef.current = { controller, isLoadingMore: false };
    const timer = setTimeout(() => {
      void loadPage({ query, signal: controller.signal }).then(
        (loaded) => {
          if (!controller.signal.aborted) {
            setState({ query, visibilityKey, page: loaded, isLoading: false });
          }
        },
        (failure: unknown) => {
          if (!controller.signal.aborted) {
            const error = messageSearchError(failure);
            setState({ query, visibilityKey, error, isLoading: false });
          }
        },
      );
    }, SEARCH_DELAY_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [loadPage, query, visibilityKey]);

  useEffect(() => {
    const now = Date.now();
    const deadlines = page?.hits.flatMap((message) => {
      return message.expires_at ? [Date.parse(message.expires_at)] : [];
    });
    const next = Math.min(...(deadlines?.filter((deadline) => deadline > now) ?? []));
    if (!Number.isFinite(next)) {
      return;
    }

    const timer = setTimeout(
      () => setExpiryRevision(expiryRevision + 1),
      Math.min(next - now, MAX_TIMER_DELAY_MS),
    );
    return () => clearTimeout(timer);
  }, [expiryRevision, page]);

  async function loadMore() {
    const request = requestRef.current;
    const nextCursor = page?.next_cursor;
    if (!query || !loadPage || !page || !nextCursor || !request || request.isLoadingMore) {
      return;
    }

    request.isLoadingMore = true;
    setState({ query, visibilityKey, page, isLoading: true });
    try {
      const next = await loadPage({
        query: { ...query, cursor: nextCursor },
        signal: request.controller.signal,
      });
      if (!request.controller.signal.aborted) {
        setState({ query, visibilityKey, page: includePage(page, next), isLoading: false });
      }
    } catch (failure) {
      if (!request.controller.signal.aborted) {
        const error = messageSearchError(failure);
        setState({ query, visibilityKey, page, error, isLoading: false });
      }
    } finally {
      request.isLoadingMore = false;
    }
  }

  // Published pages remain in memory only for their exact query and visibility identity.
  const hits = page?.hits.filter((message) => {
    return !message.expires_at || Date.parse(message.expires_at) > Date.now();
  });

  return {
    page: page && hits ? { ...page, hits } : undefined,
    isLoading: query !== undefined && (current?.isLoading ?? true),
    error: current?.error,
    loadMore,
  };
}
