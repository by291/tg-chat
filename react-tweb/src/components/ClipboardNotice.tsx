import { Portal } from '@ark-ui/react/portal';
import { useEffect, useState } from 'react';
import styles from './ClipboardNotice.module.css';

const NOTICE_DURATION = 3000;

interface CopyTextOptions {
  text: string;
  successMessage: string;
  errorMessage: string;
}

/** Copy exact text and restart the feedback lifetime even for repeated identical copies. */
export function useClipboardNotice() {
  const [feedback, setFeedback] = useState<{ message: string }>();

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timer = setTimeout(() => setFeedback(undefined), NOTICE_DURATION);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function copyText({ text, successMessage, errorMessage }: CopyTextOptions) {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback({ message: successMessage });
    } catch {
      setFeedback({ message: errorMessage });
    }
  }

  return { notice: feedback?.message ?? '', copyText };
}

/** Display copy feedback outside the virtualized message so it cannot change bubble geometry. */
export function ClipboardNotice({ message }: { message: string }) {
  if (!message) {
    return null;
  }
  return (
    <Portal>
      <div className={styles.notice} role="status">
        {message}
      </div>
    </Portal>
  );
}
