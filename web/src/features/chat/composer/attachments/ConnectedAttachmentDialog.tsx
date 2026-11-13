import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { Plus, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { IconButton } from '@/components/IconButton';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { EmojiEditor, type EmojiEditorControls } from '@/features/editor/EmojiEditor';
import type { MediaSelection } from '@/features/media/uploadTransfer';
import {
  changeAttachmentMode,
  ConnectedAttachmentPreview,
  isVisualAttachment,
  selectConnectedFiles,
  type AttachmentMode,
} from './ConnectedAttachments';
import styles from './ConnectedAttachmentDialog.module.css';

const SUBMIT_FAILURE = 'Could not queue the attachments. Try sending them again.';

interface AttachmentItem {
  id: string;
  selection: MediaSelection;
}

interface AttachmentSubmission extends EmojiText {
  files: MediaSelection[];
  shouldSendFilesSeparately: boolean;
}

interface ConnectedAttachmentDialogProps {
  initialFiles: MediaSelection[];
  initialCaption: EmojiText;
  onSubmit: (submission: AttachmentSubmission) => Promise<boolean>;
  onClose: () => void;
  finalFocusEl: () => HTMLElement | null;
}

function identifyAttachment(selection: MediaSelection): AttachmentItem {
  return { id: crypto.randomUUID(), selection };
}

/** Confirm the selected sources and caption before admitting the durable upload. */
export function ConnectedAttachmentDialog({
  initialFiles,
  initialCaption,
  onSubmit,
  onClose,
  finalFocusEl,
}: ConnectedAttachmentDialogProps) {
  const [items, setItems] = useState(() => initialFiles.map(identifyAttachment));
  const [caption, setCaption] = useState(initialCaption);
  const [shouldSendAlbum, setShouldSendAlbum] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [error, setError] = useState('');
  const isSubmitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<EmojiEditorControls>(null);

  const files = items.map((item) => item.selection);
  const hasFiles = files.length > 0;
  const hasMultipleFiles = files.length > 1;
  const hasDocuments = files.some((file) => file.kind === 'document');
  const shouldSendAsFiles = hasFiles && files.every((file) => file.kind === 'document');
  const canSwitchMode = hasFiles && files.every(isVisualAttachment);
  const hasVisualAlbum = hasMultipleFiles && !hasDocuments;
  const canSend = isOpen && !isSending && hasFiles;
  const addMode: AttachmentMode = shouldSendAsFiles ? 'document' : 'media';

  function close() {
    if (!isSubmitting.current) {
      setIsOpen(false);
    }
  }

  function addFiles(sources: File[]) {
    if (!sources.length || isSubmitting.current) {
      return;
    }
    try {
      const updated = selectConnectedFiles({ current: files, files: sources, mode: addMode });
      const added = updated.slice(files.length).map(identifyAttachment);
      setItems([...items, ...added]);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not add these attachments.');
    }
  }

  function changeMode(mode: AttachmentMode) {
    try {
      const converted = items.map((item) => ({
        ...item,
        selection: changeAttachmentMode({ selection: item.selection, mode }),
      }));
      setItems(converted);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not change how files are sent.');
    }
  }

  function acceptDrop(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'drop') {
      addFiles(Array.from(event.dataTransfer.files));
    }
  }

  async function send() {
    if (!canSend || isSubmitting.current) {
      return;
    }

    // Block a second click or dismissal before React renders the busy state.
    isSubmitting.current = true;
    setIsSending(true);
    setError('');

    try {
      const shouldSendFilesSeparately = hasMultipleFiles && (hasDocuments || !shouldSendAlbum);
      const isAccepted = await onSubmit({
        ...caption,
        files,
        shouldSendFilesSeparately,
      });

      if (isAccepted) {
        setIsOpen(false);
      } else {
        setError(SUBMIT_FAILURE);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : SUBMIT_FAILURE);
    } finally {
      isSubmitting.current = false;
      setIsSending(false);
    }
  }

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          close();
        }
      }}
      initialFocusEl={() => closeRef.current}
      finalFocusEl={finalFocusEl}
      onExitComplete={onClose}
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content
            className={`${overlays.dialog} ${dialogs.confirmation} ${styles.dialog}`}
            onDragOver={acceptDrop}
            onDrop={acceptDrop}
          >
            <header className={styles.header}>
              <Dialog.Title>Send attachments</Dialog.Title>
              <IconButton
                ref={closeRef}
                label="Close attachment preview"
                disabled={isSending}
                onClick={close}
              >
                <X aria-hidden="true" />
              </IconButton>
            </header>
            <div className={styles.body}>
              {hasFiles && (
                <ul
                  className={styles.previews}
                  data-layout={hasDocuments ? 'list' : 'gallery'}
                  aria-label="Selected attachments"
                >
                  {items.map(({ id, selection }) => (
                    <ConnectedAttachmentPreview
                      key={id}
                      selection={selection}
                      isDisabled={isSending}
                      onRemove={() =>
                        setItems((current) => current.filter((item) => item.id !== id))
                      }
                    />
                  ))}
                </ul>
              )}
              <button
                type="button"
                className={overlays.textButton}
                disabled={isSending}
                onClick={() => inputRef.current?.click()}
              >
                <Plus aria-hidden="true" size={18} /> Add files
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                aria-label="Choose more attachments"
                accept={addMode === 'media' && hasFiles ? 'image/*,video/*' : undefined}
                onChange={(event) => {
                  addFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = '';
                }}
              />
              {(canSwitchMode || hasVisualAlbum) && (
                <div className={styles.options}>
                  {canSwitchMode && (
                    <label>
                      <input
                        type="checkbox"
                        checked={shouldSendAsFiles}
                        disabled={isSending}
                        onChange={(event) =>
                          changeMode(event.currentTarget.checked ? 'document' : 'media')
                        }
                      />
                      {hasMultipleFiles ? 'Send as files' : 'Send as file'}
                    </label>
                  )}
                  {hasVisualAlbum && (
                    <label>
                      <input
                        type="checkbox"
                        checked={shouldSendAlbum}
                        disabled={isSending}
                        onChange={(event) => setShouldSendAlbum(event.currentTarget.checked)}
                      />
                      Send as album
                    </label>
                  )}
                </div>
              )}
              <div className={styles.caption}>
                <EmojiEditor
                  controlsRef={captionRef}
                  label="Caption"
                  value={caption}
                  placeholder="Add a caption"
                  onChange={setCaption}
                  onSubmit={() => void send()}
                  onCancel={close}
                  onPasteImage={(file) => addFiles([file])}
                  onError={setError}
                />
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className={styles.actions}>
              <button
                type="button"
                className={overlays.textButton}
                onClick={close}
                disabled={isSending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.send}
                disabled={!canSend}
                onClick={() => void send()}
              >
                {isSending ? 'Queueing attachments…' : 'Send attachments'}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
