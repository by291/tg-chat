import { List, Pin, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { components } from '@/api/schema';
import { IconButton } from '@/components/IconButton';
import type { ChatOwner } from '../data/ChatOwner';
import { renderMessage, type CanonicalMessage } from '../data/messageModels';
import { describeMessage } from '../messageFormatting';
import styles from './ConnectedChat.module.css';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
type HistoryPage = components['schemas']['HistoryPage'];

interface PinnedMessagesProps {
  owner: Pick<ChatOwner, 'loadPins' | 'jumpToMessage'>;
  version: string;
  isListOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onError: (error: unknown) => void;
}

function pinLabel(message: CanonicalMessage): string {
  const rendered = renderMessage(message);
  return describeMessage({ ...rendered, text: rendered.text.trim() });
}

function visiblePins(page?: HistoryPage): CanonicalMessage[] {
  const now = Date.now();
  return (
    page?.messages.filter((message) => {
      return !message.expires_at || Date.parse(message.expires_at) > now;
    }) ?? []
  );
}

/** Show an authorized pin preview and page through pins independently of the timeline. */
export function PinnedMessages(props: PinnedMessagesProps) {
  const [latest, setLatest] = useState<{ page: HistoryPage; version: string }>();
  const latestPage = latest?.version === props.version ? latest.page : undefined;
  const [older, setOlder] = useState<HistoryPage>();
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [expiryTick, setExpiryTick] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const pins = [...visiblePins(latestPage), ...visiblePins(older)];
    const deadlines = pins.flatMap((message) => {
      return message.expires_at ? [Date.parse(message.expires_at)] : [];
    });
    const deadline = Math.min(...deadlines);
    if (!Number.isFinite(deadline)) {
      return;
    }
    const delay = Math.min(deadline - Date.now(), MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => setExpiryTick((current) => current + 1), Math.max(1, delay));
    return () => clearTimeout(timer);
  }, [latestPage, older, expiryTick]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setOlder(undefined);
    setIsLoading(true);
    setHasLoadError(false);

    void props.owner.loadPins().then(
      (page) => {
        if (requestGeneration.current === generation) {
          setLatest({ page, version: props.version });
          setIsLoading(false);
        }
      },
      () => {
        if (requestGeneration.current === generation) {
          setLatest(undefined);
          setIsLoading(false);
          setHasLoadError(true);
        }
      },
    );
    return () => {
      requestGeneration.current++;
    };
  }, [props.owner, props.version, reload]);

  const page = latestPage && (older ?? latestPage);
  const messages = visiblePins(page);
  const preview = visiblePins(latestPage).at(-1);

  async function loadOlder() {
    const generation = requestGeneration.current;
    setIsLoading(true);
    try {
      const loaded = await props.owner.loadPins(page?.messages[0]?.sequence);
      if (requestGeneration.current === generation) {
        setOlder(loaded);
      }
    } catch (error) {
      if (requestGeneration.current === generation) {
        props.onError(error);
      }
    } finally {
      if (requestGeneration.current === generation) {
        setIsLoading(false);
      }
    }
  }

  function jump(message: CanonicalMessage) {
    void props.owner.jumpToMessage(message.id).then(props.onClose, props.onError);
  }

  return (
    <>
      {preview && (
        <div className={styles.pinPreview} data-chat-controls>
          <button
            type="button"
            className={styles.pinJump}
            aria-label={`Pinned message: ${pinLabel(preview)}`}
            onClick={() => jump(preview)}
          >
            <Pin aria-hidden="true" />
            <span>
              <strong>Pinned message</strong>
              <span>{pinLabel(preview)}</span>
            </span>
          </button>
          <IconButton label="Open pinned messages" onClick={props.onOpen}>
            <List />
          </IconButton>
        </div>
      )}
      {props.isListOpen && (
        <section className={styles.pins} data-chat-controls aria-label="Pinned messages">
          <IconButton label="Close pins" onClick={props.onClose}>
            <X />
          </IconButton>
          {isLoading && <p role="status">Loading pinned messages…</p>}
          {hasLoadError && (
            <button type="button" onClick={() => setReload((current) => current + 1)}>
              Retry loading pinned messages
            </button>
          )}
          {page && messages.length === 0 && <p>No pinned messages.</p>}
          {messages.map((message) => (
            <button type="button" key={message.id} onClick={() => jump(message)}>
              {pinLabel(message)}
            </button>
          ))}
          {page?.has_older && (
            <button type="button" disabled={isLoading} onClick={() => void loadOlder()}>
              Older pins
            </button>
          )}
        </section>
      )}
    </>
  );
}
