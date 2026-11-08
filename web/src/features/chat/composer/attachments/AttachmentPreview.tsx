import { File, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import type { Attachment } from '@/domain/messages/media';
import styles from '../MessageComposer.module.css';

interface AttachmentPreviewProps {
  attachment?: Attachment;
  name: string;
  onRemove: () => void;
}

/** Show the selected attachment and provide its removal control. */
export function AttachmentPreview({ attachment, name, onRemove }: AttachmentPreviewProps) {
  return (
    <div className={styles.attachmentPreview}>
      {attachment ? <img src={attachment.url} alt={attachment.name} /> : <File />}
      <span>
        <strong>{attachment ? 'Photo' : 'Attachment'}</strong>
        <span>{name}</span>
      </span>
      <IconButton label="Remove attachment" onClick={onRemove}>
        <X />
      </IconButton>
    </div>
  );
}
