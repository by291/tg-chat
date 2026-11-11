import type { MessageSearchPage } from './useMessageSearch';
import styles from './MessageSearchStatus.module.css';

interface MessageSearchStatusProps {
  page?: MessageSearchPage;
  error?: string;
  isLoading: boolean;
  onLoadMore: () => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

/** Show the server's effective date range and paging state beside the matching messages. */
export function MessageSearchStatus(props: MessageSearchStatusProps) {
  const { page, error, isLoading, onLoadMore } = props;
  const dateFrom = page?.date_from ? dateFormat.format(new Date(page.date_from)) : '';
  const dateTo = page?.date_to ? dateFormat.format(new Date(page.date_to)) : '';
  return (
    <div className={styles.status}>
      {dateFrom && dateTo && (
        <p>
          {dateFrom} – {dateTo} (UTC)
        </p>
      )}
      {isLoading && <p role="status">Searching messages…</p>}
      {error && <p role="alert">{error}</p>}
      {!isLoading && !error && page?.hits.length === 0 && <p>No messages found</p>}
      {page?.is_truncated && (
        <p>Search reached its scan limit. Try narrower dates or a longer search.</p>
      )}
      {page?.next_cursor && (
        <button type="button" disabled={isLoading} onClick={onLoadMore}>
          More results
        </button>
      )}
    </div>
  );
}
