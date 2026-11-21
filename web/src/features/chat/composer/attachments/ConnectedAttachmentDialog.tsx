import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { Menu } from '@ark-ui/react/menu';
import { Ellipsis, Files, Images, Plus, Send, X } from 'lucide-react';
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
  type AttachmentItem,
} from './ConnectedAttachments';
import styles from './ConnectedAttachmentDialog.module.css';

const SUBMIT_FAILURE = 'Could not queue the attachments. Try sending them again.';

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

function identifyAttachment(selection: MediaSelection, id: string): AttachmentItem {
  const hasReadDimensions = Boolean(selection.width && selection.height);
  return {
    id,
    selection,
    hasReadDimensions,
  };
}

/** Confirm the selected sources and caption before admitting the durable upload. */
export function ConnectedAttachmentDialog({
  initialFiles,
  initialCaption,
  onSubmit,
  onClose,
  finalFocusEl,
}: ConnectedAttachmentDialogProps) {
  const [selectionState, setSelectionState] = useState(() => ({
    items: initialFiles.map((selection) => identifyAttachment(selection, crypto.randomUUID())),
    error: '',
  }));
  const { items, error } = selectionState;
  const [caption, setCaption] = useState(initialCaption);
  const [shouldSendAlbum, setShouldSendAlbum] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
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
  const isReadingDimensions =
    typeof URL.createObjectURL === 'function' &&
    items.some((item) => item.selection.kind !== 'document' && !item.hasReadDimensions);
  const canSend = isOpen && !isSending && hasFiles && !isReadingDimensions;
  const addMode: AttachmentMode = shouldSendAsFiles ? 'document' : 'media';
  const fileLabel = hasMultipleFiles ? 'Send as files' : 'Send as file';
  const modeLabel = shouldSendAsFiles ? 'Send as media' : fileLabel;

  function close() {
    if (!isSubmitting.current) {
      setIsOpen(false);
    }
  }

  function setError(message: string) {
    setSelectionState((current) => ({ ...current, error: message }));
  }

  function changeSelection(change: (current: AttachmentItem[]) => AttachmentItem[]) {
    // Apply validation and edits to the same snapshot, including queued native measurements.
    setSelectionState((current) => {
      try {
        return { items: change(current.items), error: '' };
      } catch (failure) {
        const error = failure instanceof Error ? failure.message : 'Could not change attachments.';
        return { ...current, error };
      }
    });
  }

  function addFiles(sources: File[]) {
    if (!sources.length || isSubmitting.current) {
      return;
    }

    // Allocate identities once per picker event, even when React replays its state update.
    const ids = sources.map(() => crypto.randomUUID());
    changeSelection((current) => {
      const selections = selectConnectedFiles({
        existingCount: current.length,
        files: sources,
        mode: addMode,
      });
      const added = selections.map((selection, index) => identifyAttachment(selection, ids[index]));
      return [...current, ...added];
    });
  }

  function changeMode(mode: AttachmentMode) {
    changeSelection((current) =>
      current.map((item) => ({
        ...item,
        selection: changeAttachmentMode({ selection: item.selection, mode }),
      })),
    );
  }

  function recordDimensions(id: string, dimensions?: { width: number; height: number }) {
    // Match the occurrence, since removal, mode changes and decoding can finish in any order.
    setSelectionState((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== id || item.hasReadDimensions) {
          return item;
        }

        const hasSize = dimensions && dimensions.width > 0 && dimensions.height > 0;
        return {
          ...item,
          hasReadDimensions: true,
          selection: hasSize ? { ...item.selection, ...dimensions } : item.selection,
        };
      }),
    }));
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
      initialFocusEl={() => {
        // A touch keyboard would cover the selected media as soon as the popup opens.
        const isTouchSupported = document.documentElement.dataset.touchSupported === 'true';
        return isTouchSupported ? closeRef.current : (captionRef.current?.getElement() ?? null);
      }}
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
              <IconButton
                ref={closeRef}
                label="Close attachment preview"
                disabled={isSending}
                onClick={close}
              >
                <X aria-hidden="true" />
              </IconButton>
              <Dialog.Title>Send attachments</Dialog.Title>
              <Menu.Root positioning={{ placement: 'bottom-end', gutter: 4 }}>
                <Menu.Trigger asChild>
                  <IconButton label="Attachment options" disabled={isSending}>
                    <Ellipsis />
                  </IconButton>
                </Menu.Trigger>
                <Menu.Positioner className={styles.menuPositioner}>
                  <Menu.Content className={overlays.menu} aria-label="Attachment options">
                    <Menu.Item
                      value="add"
                      className={overlays.menuItem}
                      onSelect={() => inputRef.current?.click()}
                    >
                      <Plus /> Add files
                    </Menu.Item>
                    {canSwitchMode && (
                      <Menu.Item
                        value="mode"
                        className={overlays.menuItem}
                        onSelect={() => changeMode(shouldSendAsFiles ? 'media' : 'document')}
                      >
                        <Files /> {modeLabel}
                      </Menu.Item>
                    )}
                    {hasVisualAlbum && (
                      <Menu.Item
                        value="group"
                        className={overlays.menuItem}
                        onSelect={() => setShouldSendAlbum(!shouldSendAlbum)}
                      >
                        <Images /> {shouldSendAlbum ? 'Send separately' : 'Group as album'}
                      </Menu.Item>
                    )}
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </header>
            <div className={styles.body}>
              {hasFiles && (
                <ConnectedAttachmentPreview
                  items={items}
                  isAlbum={hasVisualAlbum && shouldSendAlbum}
                  isDisabled={isSending}
                  onMeasure={recordDimensions}
                  onRemove={(id) =>
                    changeSelection((current) => current.filter((item) => item.id !== id))
                  }
                />
              )}
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
            </div>
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
              <IconButton
                className={styles.send}
                label="Send attachments"
                aria-busy={isSending || isReadingDimensions}
                disabled={!canSend}
                onClick={() => void send()}
              >
                <Send aria-hidden="true" />
              </IconButton>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
