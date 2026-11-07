import { File, Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { createAttachment, createDocumentAttachment, createVideoAttachment } from './attachments';
import { AttachmentMenu, type AttachmentAction } from './AttachmentMenu';
import { ComposerSendButton } from './ComposerSendButton';
import { ComposerListDialog } from './ComposerListDialog';
import type { MessageMedia } from '../messageMedia';
import { EmojiEditor, type EmojiEditorControls } from './EmojiEditor';
import type { EmojiText, CustomEmojiEntity } from '../emoji/customEmojiEntities';
import { EmojiPicker } from './EmojiPicker';
import { ComposerContextBar } from './ComposerContextBar';
import { DiscardEditDialog } from './DiscardEditDialog';
import { hasMessageEditChanged } from './messageEditing';
import type { Attachment, Message } from '../model';
import {
  captureOutgoingMessage,
  type OutgoingMessageOrigin,
} from '../messages/outgoingMessageTransition';
import styles from './MessageComposer.module.css';

const EXPAND_BUTTON_MIN_HEIGHT = 72;

export interface ComposedMessage extends EmojiText {
  sendOrigin?: OutgoingMessageOrigin;
  attachment?: Attachment;
  sticker?: string;
  media?: MessageMedia;
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
  const editorRowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileModeRef = useRef<'media' | 'document'>('media');
  const isMountedRef = useRef(true);
  const attachmentRequestRef = useRef(0);
  const [editValue, setEditValue] = useState<EmojiText>({
    text: editingMessage?.text ?? '',
    customEmoji: editingMessage?.customEmoji,
    richText: editingMessage?.richText,
  });
  const [attachment, setAttachment] = useState<Attachment>();
  const [mediaAttachment, setMediaAttachment] = useState<MessageMedia>();
  const [attachmentName, setAttachmentName] = useState('');
  const [listDialog, setListDialog] = useState<'poll' | 'checklist'>();
  const [isLoadingAttachment, setIsLoadingAttachment] = useState(false);
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
    Boolean(attachment || mediaAttachment || editingMessage?.attachment || editingMessage?.media);
  const contextMessage = editingMessage || replyMessage;
  const previousContextRef = useRef(contextMessage);
  const canSubmit = Boolean(editingMessage) || hasContent;
  const isPreparingAttachment = !editingMessage && isLoadingAttachment;

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

    const editor = editorRef.current?.getElement();
    const field = editorRowRef.current;
    const canAnimateText = !editingMessage && !attachment && !mediaAttachment && editor && field;
    const sendOrigin = canAnimateText ? captureOutgoingMessage({ field, editor }) : undefined;
    onSubmit({
      ...value,
      sendOrigin,
      attachment: editingMessage ? undefined : attachment,
      media: editingMessage ? undefined : mediaAttachment,
    });
    setIsExpanded(false);
    if (!editingMessage) {
      setAttachment(undefined);
      setMediaAttachment(undefined);
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
    attachmentRequestRef.current += 1;
    setAttachment(undefined);
    setMediaAttachment(undefined);
    setIsLoadingAttachment(false);
  }

  function selectAttachment(action: AttachmentAction) {
    if (action === 'article') {
      setIsExpanded(true);
      // Ark restores trigger focus when the menu closes; place the caret after that handoff.
      requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }
    if (action === 'poll' || action === 'checklist') {
      setListDialog(action);
      return;
    }
    const input = fileInputRef.current;
    if (!input) {
      return;
    }
    fileModeRef.current = action;
    input.accept = action === 'document' ? '' : 'image/*,video/*';
    input.click();
  }

  async function attachFile(file?: File, mode: 'media' | 'document' = 'media') {
    if (!file || editingMessage) {
      return;
    }

    attachmentRequestRef.current += 1;
    const requestId = attachmentRequestRef.current;
    setIsLoadingAttachment(true);
    try {
      let nextImage: Attachment | undefined;
      let nextMedia: MessageMedia | undefined;
      if (mode === 'document') {
        nextMedia = await createDocumentAttachment(file);
      } else if (file.type.startsWith('video/')) {
        nextMedia = await createVideoAttachment(file);
      } else {
        nextImage = await createAttachment(file);
      }
      // Only the latest selection owns the preview and loading state.
      if (isMountedRef.current && requestId === attachmentRequestRef.current) {
        setAttachment(nextImage);
        setMediaAttachment(nextMedia);
        setAttachmentName(file.name);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open this attachment.';
      if (isMountedRef.current && requestId === attachmentRequestRef.current) {
        onNotify(message);
      }
    } finally {
      if (isMountedRef.current && requestId === attachmentRequestRef.current) {
        setIsLoadingAttachment(false);
      }
    }
  }

  return (
    <div
      className={styles.composer}
      data-message-composer
      data-dragging={isDragging}
      data-has-context={Boolean(contextMessage || forwardMessages?.length)}
      data-has-attachment={Boolean((attachment || mediaAttachment) && !editingMessage)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        void attachFile(event.dataTransfer.files[0]);
      }}
    >
      <ComposerContextBar
        replyMessage={replyMessage}
        editingMessage={editingMessage}
        forwardMessages={forwardMessages}
        onJumpToMessage={onJumpToMessage}
        onCancel={requestCancelContext}
      />
      {(attachment || mediaAttachment) && !editingMessage && (
        <div className={styles.attachmentPreview}>
          {attachment ? <img src={attachment.url} alt={attachment.name} /> : <File />}
          <span>
            <strong>{attachment ? 'Photo' : 'Attachment'}</strong>
            <span>{attachmentName}</span>
          </span>
          <IconButton label="Remove attachment" onClick={removeAttachment}>
            <X />
          </IconButton>
        </div>
      )}
      <div ref={editorRowRef} className={styles.editorRow} data-expanded={isExpanded}>
        <AttachmentMenu
          isDisabled={Boolean(editingMessage) || isLoadingAttachment}
          isExpanded={isExpanded}
          onSelect={selectAttachment}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className={styles.fileInput}
          aria-label="Choose an attachment"
          onChange={(event) => {
            void attachFile(event.target.files?.[0], fileModeRef.current);
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
          placeholder={isPreparingAttachment ? 'Preparing attachment…' : 'Message'}
          onChange={updateText}
          onSubmit={sendMessage}
          onCancel={cancelComposition}
          onPasteImage={(file) => void attachFile(file)}
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
      {listDialog && (
        <ComposerListDialog
          kind={listDialog}
          onClose={() => setListDialog(undefined)}
          onSubmit={(message) => {
            onSubmit(message);
            // Sending clears the stored draft; independent polls and lists must restore it.
            onDraftChange(value);
          }}
        />
      )}
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
