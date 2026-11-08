import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { AttachmentMenu, type AttachmentAction } from './attachments/AttachmentMenu';
import { AttachmentPreview } from './attachments/AttachmentPreview';
import { useComposerAttachments } from './attachments/useComposerAttachments';
import { ComposerSendButton } from './ComposerSendButton';
import { ComposerListDialog } from './forms/ComposerListDialog';
import type { MessageMedia } from '@/domain/messages/media';
import { EmojiEditor, type EmojiEditorControls } from '@/features/editor/EmojiEditor';
import type { EmojiText, CustomEmojiEntity } from '@/domain/messages/customEmoji';
import { EmojiPicker } from './picker/EmojiPicker';
import { ComposerContextBar } from './context/ComposerContextBar';
import { DiscardEditDialog } from './context/DiscardEditDialog';
import { hasMessageEditChanged } from './context/messageEditing';
import type { Attachment } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';
import {
  captureOutgoingMessage,
  type OutgoingMessageOrigin,
} from '../messages/transitions/outgoingMessageTransition';
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
  isTextOnly?: boolean;
  isDisabled?: boolean;
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

/** Coordinate the editable draft, composition modes, and message submission boundary. */
export function MessageComposer({
  draft,
  isTextOnly = false,
  isDisabled = false,
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
  const attachments = useComposerAttachments({
    isEditing: Boolean(editingMessage),
    onNotify,
  });
  const { attachment, mediaAttachment, isLoadingAttachment } = attachments;
  const [editValue, setEditValue] = useState<EmojiText>({
    text: editingMessage?.text ?? '',
    customEmoji: editingMessage?.customEmoji,
    richText: editingMessage?.richText,
  });
  const [listDialog, setListDialog] = useState<'poll' | 'checklist'>();
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
  const canSubmit = !isDisabled && (Boolean(editingMessage) || hasContent);
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
      attachments.removeAttachment();
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

    attachments.removeAttachment();
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

    attachments.selectFile(action);
  }

  return (
    <div
      className={styles.composer}
      data-message-composer
      data-dragging={attachments.isDragging}
      data-has-context={Boolean(contextMessage || forwardMessages?.length)}
      data-has-attachment={Boolean((attachment || mediaAttachment) && !editingMessage)}
      onDragOver={isTextOnly ? (event) => event.preventDefault() : attachments.dragOver}
      onDragLeave={isTextOnly ? undefined : attachments.dragLeave}
      onDrop={isTextOnly ? (event) => event.preventDefault() : attachments.dropFile}
    >
      <ComposerContextBar
        replyMessage={replyMessage}
        editingMessage={editingMessage}
        forwardMessages={forwardMessages}
        onJumpToMessage={onJumpToMessage}
        onCancel={requestCancelContext}
      />
      {(attachment || mediaAttachment) && !editingMessage && (
        <AttachmentPreview
          attachment={attachment}
          name={attachments.attachmentName}
          onRemove={attachments.removeAttachment}
        />
      )}
      <div ref={editorRowRef} className={styles.editorRow} data-expanded={isExpanded}>
        {!isTextOnly && (
          <>
            <AttachmentMenu
              isDisabled={Boolean(editingMessage) || isLoadingAttachment}
              isExpanded={isExpanded}
              onSelect={selectAttachment}
            />
            <input
              ref={attachments.fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className={styles.fileInput}
              aria-label="Choose an attachment"
              onChange={attachments.changeFile}
            />
          </>
        )}
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
          onPasteImage={
            isTextOnly
              ? () => onNotify('Only text and emoji can be sent in this conversation.')
              : attachments.pasteImage
          }
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
            editingMessage || isTextOnly ? undefined : (sticker) => onSubmit({ text: '', sticker })
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
