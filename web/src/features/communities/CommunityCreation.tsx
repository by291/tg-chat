import { Camera } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { prepareAvatar } from '@/features/media/avatarUpload';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';
import type { CommunityOperations } from './CommunityOperations';
import type { CommunityKind, Conversation } from './communityModels';
import styles from './Communities.module.css';

interface CommunityCreationProps {
  kind: CommunityKind;
  session: SessionOwner;
  chat: ChatOwner;
  operations: CommunityOperations;
  isAvatarAvailable: boolean;
  captureIntent: () => () => boolean;
  onOpen: (conversation: Conversation) => void;
}

/** Retain the admitted community while its optional photo is prepared and assigned. */
export function CommunityCreation(props: CommunityCreationProps) {
  const { session, operations } = props;
  const active = useRef<AbortController>(undefined);
  const [created, setCreated] = useState<Conversation>();
  const [selection, setSelection] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const transfer = useRef<ReturnType<typeof prepareAvatar>>(undefined);
  const preparedFile = useRef<string>(undefined);
  const [selectionError, setSelectionError] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!selection) {
      return;
    }
    const url = URL.createObjectURL(selection);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);

  function selectPhoto(file?: File) {
    if (!file) {
      return;
    }
    try {
      transfer.current = prepareAvatar(file);
      preparedFile.current = undefined;
      setSelection(file);
      setSelectionError('');
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Choose another photo.');
    }
  }

  async function publishPhoto(options: {
    conversation: Conversation;
    signal: AbortSignal;
    isCurrent: () => boolean;
  }) {
    if (!props.isAvatarAvailable || !transfer.current) {
      return;
    }
    const fileId =
      preparedFile.current ?? (await transfer.current({ session, signal: options.signal }));
    preparedFile.current = fileId;
    if (!options.isCurrent()) {
      return;
    }

    const directory = props.chat.getSnapshot().conversations;
    const latest = directory.find((entry) => entry.id === options.conversation.id);
    if (!latest?.can_manage) {
      throw new ApiError({ code: 'forbidden', message: 'Community management is unavailable.' });
    }
    await operations.command({
      conversationId: latest.id,
      action: {
        kind: 'avatar',
        expected_version: latest.settings_version,
        file_id: fileId,
      },
    });
  }

  async function submit(fields: FormData) {
    if (active.current) {
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const hasIntent = props.captureIntent();
    const isCurrent = () => hasIntent() && !controller.signal.aborted;
    try {
      let conversation = created;
      if (!conversation) {
        const receipt = await operations.create({
          ...readCommunitySettings(fields),
          kind: props.kind,
        });
        conversation = receipt.conversation ?? undefined;
        if (!conversation) {
          throw new ApiError({ code: 'unavailable', message: 'The community is unavailable.' });
        }
        // Admission is complete. Retrying a photo must never submit another create operation.
        setCreated(conversation);
      }
      if (!isCurrent()) {
        return;
      }
      // prettier-ignore
      await publishPhoto({
        conversation,
        signal: controller.signal,
        isCurrent,
      });
      // Native Back and newer sidebar choices own focus even if the write was admitted later.
      if (isCurrent()) {
        props.onOpen(conversation);
      }
    } finally {
      active.current = undefined;
    }
  }

  const avatar = props.isAvatarAvailable && (
    <>
      <label className={styles.avatar}>
        {preview ? <img src={preview} alt="Selected community photo" /> : <Camera aria-hidden />}
        <input
          type="file"
          accept="image/*"
          aria-label="Choose community photo"
          onChange={(event) => selectPhoto(event.currentTarget.files?.[0])}
        />
      </label>
      {created && <p role="status">Community created. Finish adding its photo.</p>}
      {selectionError && <p role="alert">{selectionError}</p>}
    </>
  );

  return (
    <div className={styles.creation} data-community-creation>
      <CommunitySettingsForm creation={{ avatar, isCreated: Boolean(created) }} onSubmit={submit} />
    </div>
  );
}
