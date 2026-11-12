import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { AttachmentMenu, type AttachmentAction } from './attachments/AttachmentMenu';
import { AttachmentPreview } from './attachments/AttachmentPreview';
import { ConnectedAttachmentDialog } from './attachments/ConnectedAttachmentDialog';
import { selectConnectedFiles, type AttachmentMode } from './attachments/ConnectedAttachments';
import { useVoiceRecorder } from '@/features/media/useVoiceRecorder';
import { VoiceRecordingBar } from '@/features/media/VoiceRecordingBar';
import type { MediaSelection } from '@/features/media/uploadTransfer';
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
  files?: MediaSelection[];
  shouldSendFilesSeparately?: boolean;
  shouldPreserveDraft?: boolean;
  disableLinkPreview?: boolean;
}

interface AttachmentPreviewState {
  files: MediaSelection[];
  caption: EmojiText;
  draftIdentity: string;
}

interface MessageComposerProps {
  draft: string;
  draftIdentity?: string;
  isTextOnly?: boolean;
  canSendSticker?: boolean;
  isMediaAvailable?: boolean;
  isPollAnonymousOnly?: boolean;
  isDisabled?: boolean;
  draftCustomEmoji?: CustomEmojiEntity[];
  draftRichText?: string;
  replyMessage?: Message;
  editingMessage?: Message;
  forwardMessages?: Message[];
  onDraftChange: (value: EmojiText) => void;
  onSubmit: (message: ComposedMessage) => void;
  onMediaSubmit?: (message: ComposedMessage) => Promise<boolean>;
  onShareContact?: () => void;
  onChecklistSubmit?: (message: ComposedMessage) => Promise<boolean>;
  onPollSubmit?: (message: ComposedMessage) => Promise<boolean>;
  onCancelContext: () => void;
  onJumpToMessage: (messageId: string) => void;
  onNotify: (message: string) => void;
}

/** Coordinate the editable draft, composition modes, and message submission boundary. */
export function MessageComposer({
  draft,
  draftIdentity,
  isTextOnly = false,
  canSendSticker = false,
  isMediaAvailable = false,
  isPollAnonymousOnly = false,
  isDisabled = false,
  draftCustomEmoji,
  draftRichText,
  replyMessage,
  editingMessage,
  forwardMessages,
  onDraftChange,
  onSubmit,
  onMediaSubmit,
  onShareContact,
  onPollSubmit,
  onChecklistSubmit,
  onCancelContext,
  onJumpToMessage,
  onNotify,
}: MessageComposerProps) {
  const connectedInput = useRef<HTMLInputElement>(null);
  const connectedMode = useRef<AttachmentMode>('media');
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState>();
  const recordingDraftIdentity = useRef<string>(undefined);
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
  const [isPreviewDisabled, setIsPreviewDisabled] = useState(false);
  const [editorHeight, setEditorHeight] = useState(0);
  const canExpand = editorHeight >= EXPAND_BUTTON_MIN_HEIGHT || isExpanded;
  const draftValue: EmojiText = {
    text: draft,
    customEmoji: draftCustomEmoji,
    richText: draftRichText,
  };
  const value = editingMessage ? editValue : draftValue;
  const currentDraftIdentity = draftIdentity ?? JSON.stringify(draftValue);
  const recorder = useVoiceRecorder((selection) => {
    if (!onMediaSubmit || isDisabled || editingMessage) {
      return false;
    }

    return onMediaSubmit({
      text: '',
      files: [selection],
      shouldPreserveDraft: recordingDraftIdentity.current !== currentDraftIdentity,
    });
  });
  const text = value.text;
  const hasLink = /https?:\/\//i.test(text) || /href=["']https?:\/\//i.test(value.richText ?? '');
  const canShowPreviewControl = isTextOnly && hasLink;
  const didPreviewChange = Boolean(editingMessage?.disableLinkPreview) !== isPreviewDisabled;
  const hasContent =
    Boolean(forwardMessages?.length) ||
    text.trim().length > 0 ||
    Boolean(value.richText) ||
    Boolean(attachment || mediaAttachment || editingMessage?.attachment || editingMessage?.media);
  const contextMessage = editingMessage || replyMessage;
  const previousContextRef = useRef(contextMessage);
  const canSubmit = !isDisabled && !recorder.isActive && (Boolean(editingMessage) || hasContent);
  const isPreparingAttachment = !editingMessage && isLoadingAttachment;

  useEffect(() => {
    if (!text && !value.richText) {
      setIsExpanded(false);
      if (!editingMessage) {
        setIsPreviewDisabled(false);
      }
    }
  }, [editingMessage, text, value.richText]);

  useEffect(() => {
    // Only the editor remounts when switching modes; the attachment draft and animated bar survive.
    setIsDiscardOpen(false);
    setIsPreviewDisabled(Boolean(editingMessage?.disableLinkPreview));
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
    if (!canSubmit || isPreparingAttachment || attachmentPreview) {
      return;
    }

    const hasTextChange =
      editingMessage && hasMessageEditChanged({ original: editingMessage, current: value });
    if (editingMessage && !hasTextChange && !didPreviewChange) {
      onCancelContext();
      return;
    }

    const editor = editorRef.current?.getElement();
    const field = editorRowRef.current;
    const canAnimateText = !editingMessage && !attachment && !mediaAttachment && editor && field;
    const sendOrigin = canAnimateText ? captureOutgoingMessage({ field, editor }) : undefined;
    const submitted: ComposedMessage = {
      ...value,
      sendOrigin,
      attachment: editingMessage ? undefined : attachment,
      media: editingMessage ? undefined : mediaAttachment,
      disableLinkPreview: canShowPreviewControl && didPreviewChange ? isPreviewDisabled : undefined,
    };
    onSubmit(submitted);
    setIsExpanded(false);
    if (!editingMessage) {
      attachments.removeAttachment();
    }
    editorRef.current?.focus();
  }

  function requestCancelContext() {
    const hasUnsavedEdit =
      editingMessage &&
      (didPreviewChange || hasMessageEditChanged({ original: editingMessage, current: value }));
    if (hasUnsavedEdit) {
      setIsDiscardOpen(true);
      return;
    }

    onCancelContext();
  }

  function cancelComposition() {
    if (recorder.isActive) {
      recorder.cancel();
      return;
    }
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

  function previewFiles(files: File[], mode: AttachmentMode) {
    const isUnavailable = !isMediaAvailable || !onMediaSubmit || editingMessage || isDisabled;
    if (isUnavailable || recorder.isActive || attachmentPreview || !files.length) {
      return;
    }

    try {
      const selections = selectConnectedFiles({ current: [], files, mode });
      setAttachmentPreview({
        files: selections,
        caption: draftValue,
        draftIdentity: currentDraftIdentity,
      });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Could not select these attachments.');
    }
  }

  function startRecording() {
    if (isDisabled || attachmentPreview || !onMediaSubmit) {
      return;
    }

    recordingDraftIdentity.current = currentDraftIdentity;
    void recorder.start();
  }

  function selectAttachment(action: AttachmentAction) {
    if (action === 'contact') {
      onShareContact?.();
      return;
    }
    if (isMediaAvailable && (action === 'media' || action === 'document')) {
      const input = connectedInput.current;
      if (input) {
        connectedMode.current = action;
        input.accept = action === 'media' ? 'image/*,video/*' : '';
        input.multiple = true;
        input.click();
      }
      return;
    }
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

  const canSelectSticker = !editingMessage && !isDisabled && (!isTextOnly || canSendSticker);

  return (
    <div
      className={styles.composer}
      data-message-composer
      data-dragging={attachments.isDragging}
      data-has-context={Boolean(contextMessage || forwardMessages?.length)}
      data-has-attachment={Boolean((attachment || mediaAttachment) && !editingMessage)}
      onDragOver={isTextOnly ? (event) => event.preventDefault() : attachments.dragOver}
      onDragLeave={isTextOnly ? undefined : attachments.dragLeave}
      onDrop={(event) => {
        if (!isTextOnly) {
          attachments.dropFile(event);
          return;
        }
        event.preventDefault();
        previewFiles(Array.from(event.dataTransfer.files), 'media');
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
        <AttachmentPreview
          attachment={attachment}
          name={attachments.attachmentName}
          onRemove={attachments.removeAttachment}
        />
      )}
      {isMediaAvailable && recorder.isActive && <VoiceRecordingBar recorder={recorder} />}
      {isMediaAvailable && recorder.error && <p role="alert">{recorder.error}</p>}
      <div
        ref={editorRowRef}
        className={styles.editorRow}
        data-expanded={isExpanded}
        data-recording={recorder.isActive}
      >
        {(!isTextOnly ||
          isMediaAvailable ||
          onShareContact ||
          onPollSubmit ||
          onChecklistSubmit) && (
          <>
            <AttachmentMenu
              isConnected={isTextOnly}
              isMediaAvailable={isMediaAvailable}
              canShareContact={Boolean(onShareContact)}
              canSendPoll={Boolean(onPollSubmit)}
              canSendChecklist={Boolean(onChecklistSubmit)}
              isDisabled={Boolean(editingMessage) || isLoadingAttachment || isDisabled}
              isExpanded={isExpanded}
              onSelect={selectAttachment}
            />
            {(!isTextOnly || isMediaAvailable) && (
              <input
                ref={isMediaAvailable ? connectedInput : attachments.fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                className={styles.fileInput}
                aria-label="Choose an attachment"
                onChange={(event) => {
                  if (!isMediaAvailable) {
                    attachments.changeFile(event);
                    return;
                  }

                  previewFiles(Array.from(event.target.files ?? []), connectedMode.current);
                  event.target.value = '';
                }}
              />
            )}
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
              ? (file) => {
                  if (isMediaAvailable) {
                    previewFiles([file], 'media');
                  } else {
                    onNotify('Only text and emoji can be sent in this conversation.');
                  }
                }
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
            canSelectSticker ? (sticker) => onSubmit({ text: '', sticker }) : undefined
          }
        />
        <ComposerSendButton
          isEditing={Boolean(editingMessage)}
          hasContent={hasContent}
          isPreparingAttachment={isPreparingAttachment || isDisabled || recorder.isActive}
          onRecord={isMediaAvailable && recorder.isSupported ? startRecording : undefined}
          onSend={sendMessage}
        />
      </div>
      {canShowPreviewControl && !recorder.isActive && (
        <label className={styles.previewPreference}>
          <input
            type="checkbox"
            checked={isPreviewDisabled}
            disabled={isDisabled}
            onChange={(event) => setIsPreviewDisabled(event.target.checked)}
          />
          Disable link preview
        </label>
      )}
      {attachmentPreview && onMediaSubmit && !editingMessage && (
        <ConnectedAttachmentDialog
          initialFiles={attachmentPreview.files}
          initialCaption={attachmentPreview.caption}
          onSubmit={(submission) =>
            onMediaSubmit({
              ...submission,
              shouldPreserveDraft: currentDraftIdentity !== attachmentPreview.draftIdentity,
            })
          }
          onClose={() => setAttachmentPreview(undefined)}
          finalFocusEl={() => editorRef.current?.getElement() ?? null}
        />
      )}
      {listDialog && (
        <ComposerListDialog
          kind={listDialog}
          isConnected={isTextOnly}
          isPollAnonymousOnly={isPollAnonymousOnly}
          onClose={() => setListDialog(undefined)}
          onSubmit={(message) => {
            if (message.media?.kind === 'poll' && onPollSubmit) {
              return onPollSubmit(message);
            }
            if (message.media?.kind === 'checklist' && onChecklistSubmit) {
              return onChecklistSubmit(message);
            }

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
