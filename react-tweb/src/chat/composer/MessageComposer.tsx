import { ImagePlus, Maximize2, Minimize2, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { createAttachment } from './attachments';
import { ComposerSendButton } from './ComposerSendButton';
import { EmojiEditor, type EmojiEditorControls } from './EmojiEditor';
import type { EmojiText, CustomEmojiEntity } from '../emoji/customEmojiEntities';
import { EmojiPicker } from './EmojiPicker';
import { ComposerContextBar } from './ComposerContextBar';
import { DiscardEditDialog } from './DiscardEditDialog';
import { hasMessageEditChanged } from './messageEditing';
import type { Attachment, Message } from '../model';
import styles from './MessageComposer.module.css';

const EXPAND_BUTTON_MIN_HEIGHT = 72;

export interface ComposedMessage extends EmojiText {
  attachment?: Attachment;
  sticker?: string;
}

interface MessageComposerProps {
  draft: string;
  draftCustomEmoji?: CustomEmojiEntity[];
  draftRichText?: string;
  replyMessage?: Message;
  editingMessage?: Message;
  forwardMessages?: Message[];
  onDraftChange: (value: EmojiText) => void;
  onSubmit: (message: ComposedMessage) => void;
  onCancelContext: () => void;
  onJumpToMessage: (messageId: string) => void;
  onNotify: (message: string) => void;
}

/** Own the editable draft, attachment preview, and keyboard submission boundary. */
export function MessageComposer({
  draft,
  draftCustomEmoji,
  draftRichText,
  replyMessage,
  editingMessage,
  forwardMessages,
  onDraftChange,
  onSubmit,
  onCancelContext,
  onJumpToMessage,
  onNotify,
}: MessageComposerProps) {
  const editorRef = useRef<EmojiEditorControls>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const imageRequestRef = useRef(0);
  const [editValue, setEditValue] = useState<EmojiText>({
    text: editingMessage?.text ?? '',
    customEmoji: editingMessage?.customEmoji,
    richText: editingMessage?.richText,
  });
  const [attachment, setAttachment] = useState<Attachment>();
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [editorHeight, setEditorHeight] = useState(0);
  const canExpand = editorHeight >= EXPAND_BUTTON_MIN_HEIGHT || isExpanded;
  const draftValue: EmojiText = {
    text: draft,
    customEmoji: draftCustomEmoji,
    richText: draftRichText,
  };
  const value = editingMessage ? editValue : draftValue;
  const text = value.text;
  const hasContent =
    Boolean(forwardMessages?.length) ||
    text.trim().length > 0 ||
    Boolean(value.richText) ||
    Boolean(attachment || editingMessage?.attachment || editingMessage?.media);
  const contextMessage = editingMessage || replyMessage;
  const previousContextRef = useRef(contextMessage);
  const canSubmit = Boolean(editingMessage) || hasContent;
  const isPreparingAttachment = !editingMessage && isLoadingImage;

  useEffect(() => {
    if (!text && !value.richText) {
      setIsExpanded(false);
    }
  }, [text, value.richText]);

  useEffect(() => {
    // Only the editor remounts when switching modes; the attachment draft and animated bar survive.
    setIsDiscardOpen(false);
    setEditValue({
      text: editingMessage?.text ?? '',
      customEmoji: editingMessage?.customEmoji,
      richText: editingMessage?.richText,
    });
  }, [editingMessage]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const previousContext = previousContextRef.current;
    previousContextRef.current = contextMessage;
    if (!contextMessage && !previousContext && !forwardMessages?.length) {
      return;
    }

    // The menu restores message-row focus first; editing takes focus on the following frame.
    const frame = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextMessage, forwardMessages]);

  function updateText(value: EmojiText) {
    if (editingMessage) {
      setEditValue(value);
      return;
    }

    onDraftChange(value);
  }

  function sendMessage() {
    if (!canSubmit || isPreparingAttachment) {
      return;
    }

    if (editingMessage && !hasMessageEditChanged({ original: editingMessage, current: value })) {
      onCancelContext();
      return;
    }

    onSubmit({ ...value, attachment: editingMessage ? undefined : attachment });
    setIsExpanded(false);
    if (!editingMessage) {
      setAttachment(undefined);
    }
    editorRef.current?.focus();
  }

  function requestCancelContext() {
    const hasUnsavedEdit =
      editingMessage && hasMessageEditChanged({ original: editingMessage, current: value });
    if (hasUnsavedEdit) {
      setIsDiscardOpen(true);
      return;
    }
    onCancelContext();
  }

  function cancelComposition() {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (contextMessage || forwardMessages?.length) {
      requestCancelContext();
      return;
    }
    removeAttachment();
  }

  function removeAttachment() {
    // Cancelling invalidates a pending decode so it cannot restore the removed preview.
    imageRequestRef.current += 1;
    setAttachment(undefined);
    setIsLoadingImage(false);
  }

  async function attachImage(file?: File) {
    if (!file || editingMessage) {
      return;
    }

    imageRequestRef.current += 1;
    const requestId = imageRequestRef.current;
    setIsLoadingImage(true);
    try {
      const nextAttachment = await createAttachment(file);
      // Only the latest selection owns the preview and loading state.
      if (isMountedRef.current && requestId === imageRequestRef.current) {
        setAttachment(nextAttachment);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open this image.';
      if (isMountedRef.current && requestId === imageRequestRef.current) {
        onNotify(message);
      }
    } finally {
      if (isMountedRef.current && requestId === imageRequestRef.current) {
        setIsLoadingImage(false);
      }
    }
  }

  return (
    <div
      className={styles.composer}
      data-message-composer
      data-dragging={isDragging}
      data-has-context={Boolean(contextMessage || forwardMessages?.length)}
      data-has-attachment={Boolean(attachment && !editingMessage)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        void attachImage(event.dataTransfer.files[0]);
      }}
    >
      <ComposerContextBar
        replyMessage={replyMessage}
        editingMessage={editingMessage}
        forwardMessages={forwardMessages}
        onJumpToMessage={onJumpToMessage}
        onCancel={requestCancelContext}
      />
      {attachment && !editingMessage && (
        <div className={styles.attachmentPreview}>
          <img src={attachment.url} alt={attachment.name} />
          <span>
            <strong>Photo</strong>
            <span>{attachment.name}</span>
          </span>
          <IconButton label="Remove attachment" onClick={removeAttachment}>
            <X />
          </IconButton>
        </div>
      )}
      <div className={styles.editorRow} data-expanded={isExpanded}>
        <IconButton
          label="Attach a photo"
          onClick={() => fileInputRef.current?.click()}
          disabled={Boolean(editingMessage) || isLoadingImage}
        >
          {isDragging ? <ImagePlus /> : <Paperclip />}
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className={styles.fileInput}
          aria-label="Choose an image"
          onChange={(event) => {
            void attachImage(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <EmojiEditor
          isComposer
          isExpanded={isExpanded}
          onHeightChange={setEditorHeight}
          key={editingMessage?.id ?? 'compose'}
          controlsRef={editorRef}
          value={value}
          placeholder={isPreparingAttachment ? 'Preparing photo…' : 'Message'}
          onChange={updateText}
          onSubmit={sendMessage}
          onCancel={cancelComposition}
          onPasteImage={(file) => void attachImage(file)}
          onError={onNotify}
        />
        {canExpand && (
          <IconButton
            label={isExpanded ? 'Collapse message editor' : 'Expand message editor'}
            className={styles.expandButton}
            aria-expanded={isExpanded}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setIsExpanded((previous) => !previous)}
          >
            {isExpanded ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
        )}
        <EmojiPicker
          onSelectEmoji={(emoji) => editorRef.current?.insertEmoji(emoji)}
          onSelectCustomEmoji={(emoji) => editorRef.current?.insertCustomEmoji(emoji)}
          onDeleteCharacter={() => editorRef.current?.deleteCharacter()}
          onSelectSticker={
            editingMessage ? undefined : (sticker) => onSubmit({ text: '', sticker })
          }
        />
        <ComposerSendButton
          isEditing={Boolean(editingMessage)}
          hasContent={hasContent}
          isPreparingAttachment={isPreparingAttachment}
          onSend={sendMessage}
        />
      </div>
      <DiscardEditDialog
        isOpen={isDiscardOpen}
        onKeepEditing={() => setIsDiscardOpen(false)}
        onDiscard={() => {
          setIsDiscardOpen(false);
          onCancelContext();
        }}
        finalFocusEl={() => editorRef.current?.getElement() ?? null}
      />
    </div>
  );
}
