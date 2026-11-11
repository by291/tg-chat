import { useCallback, useState } from 'react';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { Avatar } from '@/components/Avatar';
import { Ripple } from '@/components/Ripple';
import styles from './ChatSearch.module.css';

export interface SearchSender {
  id: string;
  name: string;
}

export interface SearchSenderRoster {
  revision: string;
  loadPage: (input: {
    conversationId: string;
    after?: string;
  }) => Promise<{ senders: SearchSender[]; next?: string | null }>;
}

interface SenderListProps {
  senders: SearchSender[];
  onSelect: (sender: SearchSender) => void;
}

/** Display one bounded page of sender choices without moving focus away from search. */
export function SearchSenderList({ senders, onSelect }: SenderListProps) {
  return senders.map((sender) => (
    <button
      type="button"
      key={sender.id}
      className={styles.result}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(sender)}
    >
      <Avatar initials={sender.name.slice(0, 1)} color="purple" size="small" />
      <strong>{sender.name}</strong>
      <Ripple />
    </button>
  ));
}

/** Page the authorized roster only while the search sender picker is open. */
export function SearchSenderPicker(props: {
  conversationId: string;
  loadPage: SearchSenderRoster['loadPage'];
  onSelect: SenderListProps['onSelect'];
}) {
  const { conversationId, loadPage, onSelect } = props;
  const [after, setAfter] = useState<string>();
  const load = useCallback(
    () => loadPage({ conversationId, after }),
    // prettier-ignore
    [
      conversationId,
      loadPage,
      after,
    ],
  );
  const roster = useAccountResource(load);
  const next = roster.value?.next;
  return (
    <>
      {roster.isLoading && (
        <p className={styles.empty} role="status">
          Loading members…
        </p>
      )}
      {roster.error && (
        <p className={styles.empty} role="alert">
          {roster.error}
        </p>
      )}
      <SearchSenderList senders={roster.value?.senders ?? []} onSelect={onSelect} />
      {after && (
        <button type="button" className={styles.result} onClick={() => setAfter(undefined)}>
          First members
        </button>
      )}
      {next && (
        <button type="button" className={styles.result} onClick={() => setAfter(next)}>
          More members
        </button>
      )}
    </>
  );
}
