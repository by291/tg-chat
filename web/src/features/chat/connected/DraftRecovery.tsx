import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import type { Draft } from '../data/pendingMessages';
import styles from './ConnectedChat.module.css';

interface DraftRecoveryProps {
  local: Draft;
  conflict?: Draft;
  alternatives?: Draft[];
  onKeep: () => void;
  onRestore: (draft: Draft) => void;
}

function preview(draft: Draft): string {
  return draft.value.text.trim() || '(empty draft)';
}

/** Let users review competing drafts without moving or replacing the active editor. */
export function DraftRecovery({
  local,
  conflict,
  alternatives,
  onKeep,
  onRestore,
}: DraftRecoveryProps) {
  const panelId = useId();
  const [isOpen, setIsOpen] = useState(false);
  if (!conflict && !alternatives?.length) {
    return null;
  }

  function restore(draft: Draft) {
    setIsOpen(false);
    onRestore(draft);
  }

  return (
    <section className={styles.recovery} aria-label="Draft recovery">
      <button
        type="button"
        className={styles.recoveryToggle}
        aria-controls={panelId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        Review drafts <ChevronDown aria-hidden="true" size={16} />
      </button>
      {isOpen && (
        <div id={panelId} className={styles.recoveryPanel}>
          {conflict && (
            <>
              <dl className={styles.draftComparison}>
                <div>
                  <dt>Your draft</dt>
                  <dd>{preview(local)}</dd>
                </div>
                <div>
                  <dt>Other device</dt>
                  <dd>{preview(conflict)}</dd>
                </div>
              </dl>
              <div className={styles.recoveryActions}>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onKeep();
                  }}
                >
                  Keep my draft
                </button>
                <button type="button" onClick={() => restore(conflict)}>
                  Use other draft
                </button>
              </div>
            </>
          )}
          {alternatives?.map((draft) => (
            <div key={draft.id} className={styles.recoveredDraft}>
              <strong>Recovered draft</strong>
              <p>{preview(draft)}</p>
              <button type="button" onClick={() => restore(draft)}>
                Restore recovered draft
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
