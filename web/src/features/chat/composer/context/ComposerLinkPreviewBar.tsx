import { Link, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import type { components } from '@/api/schema';
import styles from './ComposerContextBar.module.css';

interface ComposerLinkPreviewBarProps {
  preview: components['schemas']['LinkPreviewView'];
  isDisabled: boolean;
  onDismiss: () => void;
}

/** Show the draft link metadata and allow the sender to remove the card. */
export function ComposerLinkPreviewBar({
  preview,
  isDisabled,
  onDismiss,
}: ComposerLinkPreviewBarProps) {
  const title = preview.site_name.trim() || preview.title.trim() || 'Link preview';
  const pageTitle = preview.site_name.trim() ? preview.title.trim() : '';
  const detail = [pageTitle, preview.summary.trim()].filter(Boolean).join(' · ');

  return (
    <div className={styles.bar} role="group" aria-label="Link preview">
      <Link className={styles.icon} size={24} aria-hidden="true" />
      <div className={styles.preview} aria-live="polite">
        <span className={styles.summary}>
          <strong>{title}</strong>
          {detail && <span className={styles.description}>{detail}</span>}
        </span>
      </div>
      <IconButton
        label="Disable link preview"
        disabled={isDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDismiss}
      >
        <X />
      </IconButton>
    </div>
  );
}
