import { useCallback, useState } from 'react';
import { copyTextWithToast } from '@/components/copyTextWithToast';
import { requirePayload } from '@/features/auth/SessionOwner';
import { AccountForm, Field, textField, useOperation } from '@/features/accounts/AccountForm';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { findInvitee } from './inviteeDirectory';
import type { CommunityPanelProps } from './communityModels';
import styles from '@/features/accounts/Accounts.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_SECRET_BYTES = 32;
const DEFAULT_INVITE_DAYS = 7;

function invitationSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_SECRET_BYTES));
  const hexadecimal = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return hexadecimal.join('');
}

/** Create revocable links or targeted invitations without forcing accounts into membership. */
export function CommunityInvitations(props: CommunityPanelProps) {
  const [after, setAfter] = useState<string>();
  const [link, setLink] = useState('');
  const [canCopyLink, setCanCopyLink] = useState(false);
  const operation = useOperation();
  const load = useCallback(
    async () => {
      const reply = await props.session.client.GET(
        '/api/v1/communities/{conversation_id}/invitations',
        {
          params: {
            path: { conversation_id: props.conversation.id },
            query: { after },
          },
        },
      );
      return requirePayload(reply);
    },
    // prettier-ignore
    [
      props.session,
      props.conversation.id,
      props.conversation.version,
      after,
    ],
  );
  const invitations = useAccountResource(load);

  async function createLink(fields: FormData) {
    const token = invitationSecret();
    const days = Number(textField(fields, 'days'));
    const maxUses = Number(textField(fields, 'max_uses'));
    const url = new URL('/', window.location.href);
    url.hash = `invite=${token}`;
    // Keep the secret visible if confirmation is lost so the user can recover the link.
    setLink(url.href);
    setCanCopyLink(false);

    await props.command({
      kind: 'invite',
      invitation_id: crypto.randomUUID(),
      token,
      expires_at: new Date(Date.now() + days * DAY_MS).toISOString(),
      max_uses: maxUses,
    });
    setCanCopyLink(true);
  }

  async function invitePerson(fields: FormData) {
    const username = textField(fields, 'username').trim().replace(/^@/, '').toLowerCase();
    const person = await findInvitee(props.session, username);
    if (!person) {
      throw new Error('No available account has that username.');
    }
    await props.command({
      kind: 'invite',
      invitation_id: crypto.randomUUID(),
      target_id: person.id,
      expires_at: new Date(Date.now() + DEFAULT_INVITE_DAYS * DAY_MS).toISOString(),
      max_uses: 1,
    });
  }

  return (
    <section className={styles.card} aria-label="Community invitations">
      <h3>Invite links</h3>
      <AccountForm
        submitLabel="Create invite link"
        onSubmit={createLink}
        successMessage="Invite link created. Copy it before leaving this page."
      >
        <Field
          label="Expires after days"
          name="days"
          type="number"
          min={1}
          max={365}
          defaultValue={DEFAULT_INVITE_DAYS}
          required
        />
        <Field
          label="Maximum joins"
          name="max_uses"
          type="number"
          min={1}
          max={500}
          defaultValue={10}
          required
        />
      </AccountForm>
      {link && (
        <>
          <Field
            label="Invite link"
            value={link}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          {canCopyLink && (
            <button
              type="button"
              onClick={() =>
                void copyTextWithToast({
                  text: link,
                  successMessage: 'Invite link copied',
                  errorMessage: 'Could not copy the invite link. Select the link to copy it.',
                })
              }
            >
              Copy invite link
            </button>
          )}
        </>
      )}
      <p className={styles.hint}>
        Only a hash is retained by the server. Copy a successful link now; revoke it to stop future
        joins.
      </p>
      <h3>Invite a person</h3>
      <AccountForm
        submitLabel="Send invitation"
        onSubmit={invitePerson}
        successMessage="Invitation sent. The recipient must accept it."
      >
        <Field label="Invite username" name="username" required minLength={3} maxLength={32} />
      </AccountForm>
      {(invitations.error || operation.error) && (
        <p role="alert">{invitations.error || operation.error}</p>
      )}
      {invitations.value?.items.map((invitation) => (
        <article key={invitation.id} className={styles.card}>
          <p>
            {invitation.target_id ? 'Direct invitation' : 'Invite link'} · {invitation.uses}/
            {invitation.max_uses ?? 'unlimited'} joins
          </p>
          <p>Expires {new Date(invitation.expires_at).toLocaleString()}</p>
          {invitation.revoked_at ? (
            <p>Revoked</p>
          ) : (
            <button
              disabled={operation.isPending}
              onClick={() =>
                void operation.run({
                  operation: () =>
                    props.command({ kind: 'revoke_invite', invitation_id: invitation.id }),
                })
              }
            >
              Revoke invitation
            </button>
          )}
        </article>
      ))}
      {after && <button onClick={() => setAfter(undefined)}>First invitations</button>}
      {invitations.value?.next && (
        <button onClick={() => setAfter(invitations.value!.next!)}>More invitations</button>
      )}
    </section>
  );
}

/** Keep approval decisions attached to a current server-owned request and invitation. */
export function CommunityRequests(props: CommunityPanelProps) {
  const [after, setAfter] = useState<string>();
  const operation = useOperation();
  const load = useCallback(
    async () => {
      const reply = await props.session.client.GET(
        '/api/v1/communities/{conversation_id}/requests',
        {
          params: {
            path: { conversation_id: props.conversation.id },
            query: { after },
          },
        },
      );
      return requirePayload(reply);
    },
    // prettier-ignore
    [
      props.session,
      props.conversation.id,
      props.conversation.version,
      after,
    ],
  );
  const requests = useAccountResource(load);
  return (
    <section className={styles.card} aria-label="Join requests">
      <h3>Join requests</h3>
      {(requests.error || operation.error) && (
        <p role="alert">{requests.error || operation.error}</p>
      )}
      {requests.value?.items.length === 0 && <p>No pending requests.</p>}
      {requests.value?.items.map((request) => (
        <article
          key={request.id}
          className={styles.card}
          aria-label={`Request ${request.username}`}
        >
          <p>
            {request.display_name} · @{request.username}
          </p>
          <div className={styles.rowActions}>
            <button
              disabled={operation.isPending}
              onClick={() =>
                void operation.run({
                  operation: () => props.command({ kind: 'approve', user_id: request.id }),
                })
              }
            >
              Approve
            </button>
            <button
              disabled={operation.isPending}
              onClick={() =>
                void operation.run({
                  operation: () => props.command({ kind: 'reject', user_id: request.id }),
                })
              }
            >
              Reject
            </button>
          </div>
        </article>
      ))}
      {after && <button onClick={() => setAfter(undefined)}>First requests</button>}
      {requests.value?.next && (
        <button onClick={() => setAfter(requests.value!.next!)}>More requests</button>
      )}
    </section>
  );
}
