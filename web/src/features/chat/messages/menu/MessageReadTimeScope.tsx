import { CheckCheck } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { useAppPreferences } from '@/features/settings/appPreferences';
import styles from './MessageMenu.module.css';

const ReadTimeSession = createContext<SessionOwner | undefined>(undefined);

interface MessageReadTimeScopeProps {
  session?: SessionOwner;
  isDirect: boolean;
  children: ReactNode;
}

interface ReadTimeResult {
  session: SessionOwner;
  messageId: string;
  timestamp: string;
}

/** Enable exact read times for the connected private conversation only. */
export function MessageReadTimeScope({ session, isDirect, children }: MessageReadTimeScopeProps) {
  return (
    <ReadTimeSession.Provider value={isDirect ? session : undefined}>
      {children}
    </ReadTimeSession.Provider>
  );
}

/** Read the timestamp while its context menu is open and omit unavailable or private times. */
export function MessageReadTimeLine({ messageId }: { messageId: string }) {
  const session = useContext(ReadTimeSession);
  const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);
  const [result, setResult] = useState<ReadTimeResult>();

  useEffect(() => {
    if (!session) {
      return;
    }

    const request = new AbortController();
    void session.client
      .GET('/api/v1/messages/{message_id}/read-time', {
        params: { path: { message_id: messageId } },
        signal: request.signal,
      })
      .then((response) => {
        const timestamp = requirePayload(response).read_at;
        if (!request.signal.aborted && timestamp) {
          setResult({ session, messageId, timestamp });
        }
      })
      .catch(() => {
        // Private or unavailable metadata must leave the other menu actions usable.
      });

    return () => request.abort();
  }, [session, messageId]);

  if (!result || result.session !== session || result.messageId !== messageId) {
    return null;
  }

  const date = new Date(result.timestamp);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: timeFormat,
  });

  return (
    <div className={styles.readTime} role="status">
      <CheckCheck aria-hidden="true" />
      <time dateTime={result.timestamp}>Read {formatter.format(date)}</time>
    </div>
  );
}
