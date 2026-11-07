import { Forward, Check, ImagePlus, Paperclip, Pencil, Reply, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { createAttachment } from './attachments';
import { EmojiEditor, type EmojiEditorControls } from './EmojiEditor';
import type { EmojiText, CustomEmojiEntity } from '../emoji/customEmojiEntities';
import { EmojiPicker } from './EmojiPicker';
import { describeMessage } from '../messageFormatting';
import type { Attachment, Message } from '../model';
import styles from './MessageComposer.module.css';

export interface ComposedMessage extends EmojiText {
  attachment?: Attachment;
  sticker?: string;
}

interface MessageComposerProps {
  draft: string;
  draftCustomEmoji?: CustomEmojiEntity[];
  replyMessage?: Message;
  editingMessage?: Message;
  forwardMessages?: Message[];
  onDraftChange: (value: EmojiText) => void;
  onSubmit: (message: ComposedMessage) => void;
  onCancelContext: () => void;
  onNotify: (message: string) => void;
}

/** Own the editable draft, attachment preview, and keyboard submission boundary. */
export function MessageComposer({
  draft,
  draftCustomEmoji,
  replyMessage,
  editingMessage,
  forwardMessages,
  onDraftChange,
  onSubmit,
  onCancelContext,
  onNotify,
}: MessageComposerProps) {
  const editorRef = useRef<EmojiEditorControls>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const imageRequestRef = useRef(0);
  const [editValue, setEditValue] = useState<EmojiText>({
    text: editingMessage?.text ?? '',
    customEmoji: editingMessage?.customEmoji,
  });
  const [attachment, setAttachment] = useState<Attachment>();
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const value = editingMessage ? editValue : { text: draft, customEmoji: draftCustomEmoji };
  const text = value.text;
  const hasContent =
    Boolean(forwardMessages?.length) ||
    text.trim().length > 0 ||
    Boolean(attachment || editingMessage?.attachment || editingMessage?.media);
  const contextMessage = editingMessage || replyMessage;
  const forwardCount = forwardMessages?.length ?? 0;
  const forwardAuthors = [...new Set(forwardMessages?.map((message) => message.authorName))];

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!contextMessage && !forwardMessages?.length) {
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
    if (!hasContent || isLoadingImage) {
      return;
    }

    onSubmit({ ...value, attachment });
    setAttachment(undefined);
    editorRef.current?.focus();
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
      {contextMessage && (
        <div className={styles.contextBar}>
          {editingMessage ? <Pencil size={22} /> : <Reply size={24} />}
          <div>
            <strong>
              {editingMessage ? 'Edit message' : `Reply to ${contextMessage.authorName}`}
            </strong>
            <span>{describeMessage(contextMessage)}</span>
          </div>
          <IconButton label="Cancel reply or edit" onClick={onCancelContext}>
            <X />
          </IconButton>
        </div>
      )}
      {!contextMessage && Boolean(forwardMessages?.length) && (
        <div className={styles.contextBar}>
          <Forward size={24} />
          <div>
            <strong>
              Forward {forwardCount} {forwardCount === 1 ? 'message' : 'messages'}
            </strong>
            <span>{forwardAuthors.join(', ')}</span>
          </div>
          <IconButton label="Cancel forwarding" onClick={onCancelContext}>
            <X />
          </IconButton>
        </div>
      )}
      {attachment && (
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
      <div className={styles.editorRow}>
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
          controlsRef={editorRef}
          value={value}
          placeholder={isLoadingImage ? 'Preparing photo…' : 'Message'}
          onChange={updateText}
          onSubmit={sendMessage}
          onCancel={() => {
            onCancelContext();
            removeAttachment();
          }}
          onPasteImage={(file) => void attachImage(file)}
          onError={onNotify}
        />
        <EmojiPicker
          onSelectEmoji={(emoji) => editorRef.current?.insertEmoji(emoji)}
          onSelectCustomEmoji={(emoji) => editorRef.current?.insertCustomEmoji(emoji)}
          onDeleteCharacter={() => editorRef.current?.deleteCharacter()}
          onSelectSticker={
            editingMessage ? undefined : (sticker) => onSubmit({ text: '', sticker })
          }
        />
        <IconButton
          label={editingMessage ? 'Save message' : 'Send message'}
          className={styles.sendButton}
          disabled={!hasContent || isLoadingImage}
          onClick={sendMessage}
        >
          {editingMessage ? <Check /> : <Send />}
        </IconButton>
      </div>
    </div>
  );
}
