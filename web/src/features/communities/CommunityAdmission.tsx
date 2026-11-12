import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import { AccountForm, Field, textField, useOperation } from '@/features/accounts/AccountForm';
import accountStyles from '@/features/accounts/Accounts.module.css';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { ApiError, requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import type { Conversation } from './communityModels';
import styles from './CommunityAdmission.module.css';

type InvitePreview = components['schemas']['InvitePreview'];
type Invitation = components['schemas']['InvitationView'];

interface AdmissionProps {
  session: SessionOwner;
  chat: ChatOwner;
  onAdmitted: (conversation: Conversation) => void;
}

interface InviteDialogProps extends AdmissionProps {
  token: string;
  onClose: () => void;
}

const REQUEST_SENT = 'Request sent. Waiting for approval.';

function inviteToken(hash: string): string {
  return new URLSearchParams(hash.slice(1)).get('invite') ?? '';
}

function currentInviteToken(): string {
  return inviteToken(window.location.hash);
}

function removeInviteToken(token: string): void {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.get('invite') !== token) {
    return;
  }

  fragment.delete('invite');
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, '', url);
}

function joinLabel(preview: InvitePreview): string {
  if (preview.requires_approval) {
    return 'Request to join';
  }
  return preview.kind === 'channel' ? 'Subscribe' : 'Join group';
}

async function findCurrentMemberChat(
  scope: Pick<AdmissionProps, 'chat' | 'session'> & { conversationId: string },
): Promise<Conversation | undefined> {
  const { chat, session, conversationId } = scope;
  const isKnownMember = chat.getSnapshot().conversations.some((entry) => {
    return entry.id === conversationId;
  });
  if (!isKnownMember) {
    return;
  }

  try {
    // A previously loaded directory can still contain a chat whose access was revoked.
    const reply = await session.client.GET('/api/v1/communities/{conversation_id}', {
      params: { path: { conversation_id: conversationId } },
    });
    return requirePayload(reply);
  } catch {
    return;
  }
}

function CommunityInvitePreview({ session, chat, token, onAdmitted, onClose }: InviteDialogProps) {
  const [hasRequested, setHasRequested] = useState(false);
  const isCurrent = useRef(false);
  const hasOpenedMemberChat = useRef(false);
  const action = useOperation();
  const load = useCallback(async () => {
    const reply = await session.client.POST('/api/v1/community-invitations/preview', {
      body: { token },
    });
    const invitation = requirePayload(reply);
    const memberChat = await findCurrentMemberChat({
      session,
      chat,
      conversationId: invitation.id,
    });
    return { invitation, memberChat };
  }, [chat, session, token]);
  const preview = useAccountResource(load);
  const community = preview.value?.invitation;
  const memberChat = preview.value?.memberChat;

  useEffect(() => {
    isCurrent.current = true;
    return () => {
      isCurrent.current = false;
    };
  }, []);

  useEffect(() => {
    if (!memberChat || hasOpenedMemberChat.current) {
      return;
    }

    hasOpenedMemberChat.current = true;
    onAdmitted(memberChat);
    onClose();
  }, [memberChat, onAdmitted, onClose]);

  async function join(community: InvitePreview) {
    const operations = chat.communities;
    if (!operations) {
      throw new Error('Community commands are unavailable.');
    }

    const receipt = await operations.command({
      conversationId: community.id,
      action: { kind: 'join', token },
    });

    // A second link can replace this dialog while the first action is in flight.
    if (!isCurrent.current) {
      return;
    }
    if (!receipt.conversation) {
      setHasRequested(true);
      return;
    }
    onAdmitted(receipt.conversation);
    onClose();
  }

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open && !action.isPending) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${styles.dialog}`}>
            {community && (
              <Avatar initials={community.title.slice(0, 2).toUpperCase()} size="large" />
            )}
            <Dialog.Title>{community?.title ?? 'Community invitation'}</Dialog.Title>
            {community && (
              <Dialog.Description>
                {community.kind === 'channel' ? 'Channel invitation' : 'Group invitation'}
              </Dialog.Description>
            )}
            {preview.isLoading && <p role="status">Loading invitation…</p>}
            {(preview.error || action.error) && (
              <p role="alert" className={accountStyles.error}>
                {preview.error || action.error}
              </p>
            )}
            {hasRequested && <p role="status">{REQUEST_SENT}</p>}
            <div className={styles.actions}>
              <Dialog.CloseTrigger asChild>
                <button type="button" className={styles.secondary} disabled={action.isPending}>
                  {hasRequested ? 'Done' : 'Cancel'}
                </button>
              </Dialog.CloseTrigger>
              {preview.error && (
                <button type="button" className={styles.secondary} onClick={preview.reload}>
                  Retry preview
                </button>
              )}
              {community && !memberChat && !preview.isLoading && !hasRequested && (
                <button
                  type="button"
                  className={accountStyles.primary}
                  disabled={action.isPending}
                  onClick={() => void action.run({ operation: () => join(community) })}
                >
                  {joinLabel(community)}
                </button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** Preview URL invitations only after the authenticated chat workspace is ready. */
export function CommunityInviteLink(props: AdmissionProps) {
  const [token, setToken] = useState(currentInviteToken);

  useEffect(() => {
    function openLink() {
      setToken(currentInviteToken());
    }

    window.addEventListener('hashchange', openLink);
    openLink();

    return () => window.removeEventListener('hashchange', openLink);
  }, []);

  if (!token) {
    return null;
  }

  function close() {
    removeInviteToken(token);
    setToken(currentInviteToken());
  }

  function openAdmitted(conversation: Conversation) {
    if (currentInviteToken() === token) {
      props.onAdmitted(conversation);
    }
  }

  return (
    <CommunityInvitePreview
      key={token}
      {...props}
      token={token}
      onClose={close}
      onAdmitted={openAdmitted}
    />
  );
}

/** Preview pasted links and expose the account's direct invitations. */
export function CommunityAdmission(props: AdmissionProps) {
  const [token, setToken] = useState('');
  const [after, setAfter] = useState<string>();
  const [requestedIds, setRequestedIds] = useState<string[]>([]);
  const operation = useOperation();
  const load = useCallback(async () => {
    const reply = await props.session.client.GET('/api/v1/community-invitations', {
      params: { query: { after } },
    });
    return requirePayload(reply);
  }, [props.session, after]);
  const inbox = useAccountResource(load);
  const next = inbox.value?.next;

  async function previewLink(fields: FormData) {
    const input = textField(fields, 'invitation').trim();
    const fragmentStart = input.indexOf('#');
    const parsedToken = fragmentStart < 0 ? input : inviteToken(input.slice(fragmentStart));
    if (!parsedToken) {
      throw new ApiError({
        code: 'invalid_invite_link',
        message: 'Enter an invitation link or secret.',
      });
    }
    setToken(parsedToken);
  }

  async function accept(invitation: Invitation) {
    const operations = props.chat.communities;
    if (!operations) {
      throw new Error('Community commands are unavailable.');
    }

    const receipt = await operations.command({
      conversationId: invitation.conversation_id,
      action: { kind: 'join', invitation_id: invitation.id },
    });
    inbox.reload();
    if (receipt.conversation) {
      props.onAdmitted(receipt.conversation);
    } else {
      setRequestedIds((current) => [...current, invitation.id]);
    }
  }

  return (
    <section className={accountStyles.card} aria-label="Your community invitations">
      <h2>Accept an invitation</h2>
      <AccountForm submitLabel="Preview invitation" onSubmit={previewLink}>
        <Field label="Invitation link or secret" name="invitation" required />
      </AccountForm>
      {token && (
        <CommunityInvitePreview key={token} {...props} token={token} onClose={() => setToken('')} />
      )}
      {(inbox.error || operation.error) && <p role="alert">{inbox.error || operation.error}</p>}
      <h3>Direct invitations</h3>
      {inbox.isLoading && <p role="status">Loading invitations…</p>}
      {inbox.value?.items.length === 0 && <p>No pending direct invitations.</p>}
      {inbox.value?.items.map((invitation) => (
        <article
          className={accountStyles.card}
          key={invitation.id}
          aria-label={`Invitation ${invitation.title}`}
        >
          <p>{invitation.title}</p>
          {requestedIds.includes(invitation.id) ? (
            <p role="status">{REQUEST_SENT}</p>
          ) : (
            <button
              type="button"
              disabled={operation.isPending}
              onClick={() => void operation.run({ operation: () => accept(invitation) })}
            >
              Accept invitation
            </button>
          )}
        </article>
      ))}
      {after && (
        <button type="button" onClick={() => setAfter(undefined)}>
          First received invitations
        </button>
      )}
      {next && (
        <button type="button" onClick={() => setAfter(next)}>
          More received invitations
        </button>
      )}
      <button type="button" onClick={inbox.reload}>
        Refresh invitations
      </button>
    </section>
  );
}
