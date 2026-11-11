import { useEffect, useState } from 'react';
import type { components } from '@/api/schema';
import type { ChatOwner } from '../data/ChatOwner';
import { renderMessage, type CanonicalMessage } from '../data/messageModels';
import { describeMessage } from '../messageFormatting';
import styles from './ConnectedChat.module.css';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function pinLabel(message: CanonicalMessage): string {
  const rendered = renderMessage(message);
  return describeMessage({ ...rendered, text: rendered.text.trim() });
}

/** Page through authorized pins without loading unrelated history into the viewport. */
export function PinnedMessages(props: {
  owner: Pick<ChatOwner, 'loadPins' | 'jumpToMessage'>;
  version: string;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const [page, setPage] = useState<components['schemas']['HistoryPage']>();
  const [isLoading, setIsLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const deadlines =
      page?.messages.flatMap((message) =>
        message.expires_at ? [Date.parse(message.expires_at)] : [],
      ) ?? [];
    const next = Math.min(...deadlines.filter((deadline) => deadline > now));
    if (!Number.isFinite(next)) {
      return;
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(next - Date.now(), MAX_TIMER_DELAY_MS),
    );
    return () => clearTimeout(timer);
  }, [page, now]);
  const messages = page?.messages.filter(
    (message) => !message.expires_at || Date.parse(message.expires_at) > Date.now(),
  );
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
      {messages?.length === 0 && <p>No pinned messages.</p>}
      {messages?.map((message) => (
        <button
          type="button"
          key={message.id}
          onClick={() => void props.owner.jumpToMessage(message.id).catch(props.onError)}
        >
          {pinLabel(message)}
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
