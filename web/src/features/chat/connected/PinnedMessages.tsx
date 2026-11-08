import { useEffect, useState } from 'react';
import type { components } from '@/api/schema';
import type { ChatOwner } from '../data/ChatOwner';
import styles from './ConnectedChat.module.css';

/** Page through authorized pins without loading unrelated history into the viewport. */
export function PinnedMessages(props: {
  owner: ChatOwner;
  version: string;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const [page, setPage] = useState<components['schemas']['HistoryPage']>();
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    let isCurrent = true;
    setPage(undefined);
    void props.owner
      .loadPins()
      .then((loaded) => {
        if (isCurrent) {
          setPage(loaded);
        }
      })
      .catch(props.onError);
    return () => {
      isCurrent = false;
    };
  }, [props.owner, props.version]);

  async function older() {
    setIsLoading(true);
    try {
      const loaded = await props.owner.loadPins(page?.messages[0]?.sequence);
      setPage(loaded);
    } catch (error) {
      props.onError(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className={styles.pins} aria-label="Pinned messages">
      <button type="button" onClick={props.onClose}>
        Close pins
      </button>
      {page?.messages.length === 0 && <p>No pinned messages.</p>}
      {page?.messages.map((message) => (
        <button
          type="button"
          key={message.id}
          onClick={() => void props.owner.jumpToMessage(message.id).catch(props.onError)}
        >
          {message.content.text}
        </button>
      ))}
      {page?.has_older && (
        <button type="button" disabled={isLoading} onClick={() => void older()}>
          Older pins
        </button>
      )}
    </section>
  );
}
