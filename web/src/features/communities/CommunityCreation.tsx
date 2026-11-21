import { Camera } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { prepareAvatar } from '@/features/media/avatarUpload';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';
import type { CommunityOperations, CreationIdentity } from './CommunityOperations';
import type { CommunityKind, Conversation } from './communityModels';
import styles from './Communities.module.css';

interface CreationIntent extends CreationIdentity {
  isConfirmed: boolean;
}

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
  const { chat, session, operations } = props;
  const active = useRef<AbortController>(undefined);
  const [intent, setIntent] = useState<CreationIntent>();
  const isCreated = Boolean(intent?.isConfirmed);
  const pending = useSyncExternalStore(operations.subscribe, operations.getSnapshot);
  const hasUnconfirmedCreate =
    !isCreated && pending.some((entry) => entry.request.operation_id === intent?.operationId);
  const [selection, setSelection] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const transfer = useRef<ReturnType<typeof prepareAvatar>>(undefined);
  const preparedFile = useRef<string>(undefined);
  const [selectionError, setSelectionError] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  useEffect(
    () =>
      operations.observeCreation((result) => {
        setIntent((current) => {
          if (result.operationId !== current?.operationId || current.isConfirmed) {
            return current;
          }
          // Only a definitive rejection releases this form to edit and start a new operation.
          return result.outcome === 'confirmed' ? { ...current, isConfirmed: true } : undefined;
        });
      }),
    [operations],
  );
  useEffect(() => {
    if (!intent || intent.isConfirmed) {
      return;
    }
    const remembered = intent;
    function confirmFromDirectory() {
      const hasProjection = chat
        .getSnapshot()
        .conversations.some((entry) => entry.id === remembered.conversationId);
      if (hasProjection) {
        // Keep the admission fact if another tab's later sync withdraws management or membership.
        setIntent((current) =>
          current === remembered ? { ...remembered, isConfirmed: true } : current,
        );
      }
    }
    const unsubscribe = chat.subscribe(confirmFromDirectory);
    confirmFromDirectory();
    return unsubscribe;
  }, [chat, intent]);
  useEffect(() => {
    if (!selection) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(selection);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);

  function clearPhoto() {
    transfer.current = undefined;
    preparedFile.current = undefined;
    setSelection(undefined);
    setSelectionError('');
  }

  function selectPhoto(file?: File) {
    if (!file) {
      return;
    }
    // A rejected replacement invalidates the prior file and any ID prepared for its assignment.
    clearPhoto();
    try {
      transfer.current = prepareAvatar(file);
      setSelection(file);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Choose another photo.');
    }
  }

  function currentConversation(id: string) {
    return props.chat.getSnapshot().conversations.find((entry) => entry.id === id);
  }

  function requireManagement(id: string) {
    const latest = currentConversation(id);
    if (!latest?.can_manage) {
      throw new ApiError({ code: 'forbidden', message: 'Community management is unavailable.' });
    }
    return latest;
  }

  async function publishPhoto(options: {
    conversationId: string;
    signal: AbortSignal;
    isCurrent: () => boolean;
  }) {
    if (!props.isAvatarAvailable || !transfer.current) {
      return;
    }
    requireManagement(options.conversationId);
    const fileId =
      preparedFile.current ?? (await transfer.current({ session, signal: options.signal }));
    preparedFile.current = fileId;
    if (!options.isCurrent()) {
      return;
    }

    // Upload can complete after a newer membership or settings revision reaches the directory.
    const latest = requireManagement(options.conversationId);
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
    const isBlocked = active.current || selectionError || hasUnconfirmedCreate;
    if (isBlocked) {
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const hasIntent = props.captureIntent();
    const isCurrent = () => hasIntent() && !controller.signal.aborted;
    try {
      let conversationId = intent?.conversationId;
      if (conversationId && !isCreated) {
        // A different tab may have recovered or dismissed the same pending record.
        const conversation = await props.chat.checkCommunityCreation(conversationId);
        if (!conversation && isCurrent()) {
          throw new ApiError({
            code: 'unconfirmed_creation',
            message:
              'Creation is still unconfirmed. Review your communities before starting again.',
          });
        }
        return;
      }

      if (!conversationId) {
        const settings = { ...readCommunitySettings(fields), kind: props.kind };
        await operations.create(settings, (identity) => {
          conversationId = identity.conversationId;
          setIntent({ ...identity, isConfirmed: false });
        });
      }
      if (!conversationId || !isCurrent()) {
        return;
      }
      // prettier-ignore
      await publishPhoto({
        conversationId,
        signal: controller.signal,
        isCurrent,
      });
      // Native Back and newer sidebar choices own focus even if the write was admitted later.
      if (!isCurrent()) {
        return;
      }
      const latest = currentConversation(conversationId);
      if (!latest) {
        throw new ApiError({
          code: 'forbidden',
          message: 'This community is no longer available.',
        });
      }
      props.onOpen(latest);
    } finally {
      active.current = undefined;
    }
  }

  const avatar = props.isAvatarAvailable && (
    <>
      <label className={styles.avatar}>
        {selection && preview ? (
          <img src={preview} alt="Selected community photo" />
        ) : (
          <Camera aria-hidden />
        )}
        <input
          type="file"
          accept="image/*"
          aria-label="Choose community photo"
          disabled={hasUnconfirmedCreate}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            selectPhoto(file);
          }}
        />
      </label>
      {(selection || selectionError) && (
        <button type="button" disabled={hasUnconfirmedCreate} onClick={clearPhoto}>
          Clear community photo
        </button>
      )}
      {isCreated && selection && <p role="status">Community created. Finish adding its photo.</p>}
      {selectionError && <p role="alert">{selectionError}</p>}
    </>
  );

  return (
    <div className={styles.creation} data-community-creation>
      <CommunitySettingsForm
        creation={{
          avatar,
          isCreated,
          hasIntent: Boolean(intent),
          hasPhotoChoice: Boolean(selection || selectionError),
          isWaitingForReceipt: hasUnconfirmedCreate,
          isInvalid: Boolean(selectionError),
        }}
        onSubmit={submit}
      />
    </div>
  );
}
