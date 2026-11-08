import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Attachment, MessageMedia } from '@/domain/messages/media';
import { createAttachment, createDocumentAttachment, createVideoAttachment } from './attachments';

type AttachmentMode = 'media' | 'document';

interface ComposerAttachmentsOptions {
  isEditing: boolean;
  onNotify: (message: string) => void;
}

interface AttachmentSelection {
  file: File;
  mode: AttachmentMode;
}

interface AttachmentPreviewState {
  attachment?: Attachment;
  mediaAttachment?: MessageMedia;
  name: string;
}

async function decodeAttachment({
  file,
  mode,
}: AttachmentSelection): Promise<AttachmentPreviewState> {
  if (mode === 'document') {
    return {
      mediaAttachment: await createDocumentAttachment(file),
      name: file.name,
    };
  }

  if (file.type.startsWith('video/')) {
    return {
      mediaAttachment: await createVideoAttachment(file),
      name: file.name,
    };
  }

  return {
    attachment: await createAttachment(file),
    name: file.name,
  };
}

/** Own attachment input, decoding, and preview state across composer editing modes. */
export function useComposerAttachments({ isEditing, onNotify }: ComposerAttachmentsOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileModeRef = useRef<AttachmentMode>('media');
  const isMountedRef = useRef(true);
  const attachmentRequestRef = useRef(0);
  const [preview, setPreview] = useState<AttachmentPreviewState>();
  const [isLoadingAttachment, setIsLoadingAttachment] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function isCurrentRequest(requestId: number) {
    return isMountedRef.current && requestId === attachmentRequestRef.current;
  }

  function removeAttachment() {
    // Cancelling invalidates a pending decode so it cannot restore the removed preview.
    attachmentRequestRef.current += 1;
    setPreview(undefined);
    setIsLoadingAttachment(false);
  }

  function selectFile(mode: AttachmentMode) {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }

    fileModeRef.current = mode;
    input.accept = mode === 'document' ? '' : 'image/*,video/*';
    input.click();
  }

  async function attachFile({ file, mode }: AttachmentSelection) {
    if (isEditing) {
      return;
    }

    attachmentRequestRef.current += 1;
    const requestId = attachmentRequestRef.current;
    setIsLoadingAttachment(true);

    try {
      const nextPreview = await decodeAttachment({ file, mode });
      // Only the latest selection owns the preview and loading state.
      if (isCurrentRequest(requestId)) {
        setPreview(nextPreview);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open this attachment.';
      if (isCurrentRequest(requestId)) {
        onNotify(message);
      }
    } finally {
      if (isCurrentRequest(requestId)) {
        setIsLoadingAttachment(false);
      }
    }
  }

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void attachFile({ file, mode: fileModeRef.current });
    }

    // The same file must emit another change event after removal or a failed decode.
    event.target.value = '';
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function dragLeave() {
    setIsDragging(false);
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      void attachFile({ file, mode: 'media' });
    }
  }

  function pasteImage(file: File) {
    void attachFile({ file, mode: 'media' });
  }

  return {
    attachment: preview?.attachment,
    mediaAttachment: preview?.mediaAttachment,
    attachmentName: preview?.name ?? '',
    fileInputRef,
    isLoadingAttachment,
    isDragging,
    removeAttachment,
    selectFile,
    changeFile,
    dragOver,
    dragLeave,
    dropFile,
    pasteImage,
  };
}
