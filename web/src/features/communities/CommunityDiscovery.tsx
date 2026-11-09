import { useCallback, useState } from 'react';
import type { components } from '@/api/schema';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { AccountForm, Field, textField, useOperation } from '@/features/accounts/AccountForm';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import type { Conversation } from './communityModels';
import styles from '@/features/accounts/Accounts.module.css';

type Receipt = components['schemas']['CommandReceipt'];
interface AdmissionProps {
  session: SessionOwner;
  chat: ChatOwner;
  onAdmitted: (conversation: Conversation) => void;
}

/** Find bounded public metadata and explicitly request admission before opening any history. */
export function CommunityDiscovery(props: AdmissionProps) {
  const [search, setSearch] = useState('');
  const [after, setAfter] = useState<string>();
  const operation = useOperation();
  const load = useCallback(
    async () => {
      const reply = await props.session.client.GET('/api/v1/communities', {
        params: { query: { search, after } },
      });
      return requirePayload(reply);
    },
    // prettier-ignore
    [
      props.session,
      search,
      after,
    ],
  );
  const discovery = useAccountResource(load);

  async function join(id: string) {
    const receipt = await props.chat.communities!.command({
      conversationId: id,
      action: { kind: 'join' },
    });
    if (receipt.conversation) {
      props.onAdmitted(receipt.conversation);
    }
  }

  return (
    <section className={styles.card} aria-label="Public communities">
      <h2>Discover public communities</h2>
      <AccountForm
        submitLabel="Search communities"
        onSubmit={async (fields) => {
          setSearch(textField(fields, 'search'));
          setAfter(undefined);
        }}
      >
        <Field label="Community search" name="search" maxLength={100} />
      </AccountForm>
      {(discovery.error || operation.error) && (
        <p role="alert">{discovery.error || operation.error}</p>
      )}
      {operation.notice && <p role="status">{operation.notice}</p>}
      {discovery.value?.items.length === 0 && <p>No public communities found.</p>}
      {discovery.value?.items.map((community) => (
        <article key={community.id} className={styles.card} aria-label={community.title}>
          <h3>{community.title}</h3>
          <p>
            @{community.public_handle} · {community.kind} · {community.member_count} members
          </p>
          <p>{community.description}</p>
          <button
            disabled={operation.isPending}
            onClick={() =>
              void operation.run({
                operation: () => join(community.id),
                successMessage:
                  'Request recorded. Communities requiring approval appear after admission.',
              })
            }
          >
            {community.requires_approval ? 'Request to join' : 'Join community'}
          </button>
        </article>
      ))}
      {after && <button onClick={() => setAfter(undefined)}>First communities</button>}
      {discovery.value?.next && (
        <button onClick={() => setAfter(discovery.value!.next!)}>More communities</button>
      )}
    </section>
  );
}

/** Preview invite secrets without putting bearer credentials into server URL logs. */
export function CommunityAdmission(props: AdmissionProps) {
  const [preview, setPreview] = useState<components['schemas']['InvitePreview']>();
  const [token, setToken] = useState('');
  const [after, setAfter] = useState<string>();
  const operation = useOperation();
  const initialToken = new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? '';
  const load = useCallback(async () => {
    const reply = await props.session.client.GET('/api/v1/community-invitations', {
      params: { query: { after } },
    });
    return requirePayload(reply);
  }, [props.session, after]);
  const inbox = useAccountResource(load);

  function complete(receipt: Receipt) {
    inbox.reload();
    if (receipt.conversation) {
      props.onAdmitted(receipt.conversation);
    }
  }

  async function previewLink(fields: FormData) {
    const input = textField(fields, 'invitation').trim();
    const parsedToken = input.includes('#')
      ? (new URLSearchParams(new URL(input).hash.slice(1)).get('invite') ?? '')
      : input;
    setPreview(undefined);
    const reply = await props.session.client.POST('/api/v1/community-invitations/preview', {
      body: { token: parsedToken },
    });
    setToken(parsedToken);
    setPreview(requirePayload(reply));
  }

  return (
    <section className={styles.card} aria-label="Your community invitations">
      <h2>Accept an invitation</h2>
      <AccountForm submitLabel="Preview invitation" onSubmit={previewLink}>
        <Field
          label="Invitation link or secret"
          name="invitation"
          defaultValue={initialToken}
          required
        />
      </AccountForm>
      {preview && (
        <article className={styles.card}>
          <h3>{preview.title}</h3>
          <p>
            {preview.kind} · {preview.requires_approval ? 'Approval required' : 'Open invitation'}
          </p>
          <button
            disabled={operation.isPending}
            onClick={() =>
              void operation.run({
                operation: async () => {
                  const receipt = await props.chat.communities!.command({
                    conversationId: preview.id,
                    action: { kind: 'join', token },
                  });
                  complete(receipt);
                },
                successMessage: 'Request recorded. Approval may be required before admission.',
              })
            }
          >
            Join through invitation
          </button>
        </article>
      )}
      {(inbox.error || operation.error) && <p role="alert">{inbox.error || operation.error}</p>}
      {operation.notice && <p role="status">{operation.notice}</p>}
      <h3>Direct invitations</h3>
      {inbox.value?.items.length === 0 && <p>No pending direct invitations.</p>}
      {inbox.value?.items.map((invitation) => (
        <article
          className={styles.card}
          key={invitation.id}
          aria-label={`Invitation ${invitation.title}`}
        >
          <p>{invitation.title}</p>
          <button
            disabled={operation.isPending}
            onClick={() =>
              void operation.run({
                operation: async () => {
                  const receipt = await props.chat.communities!.command({
                    conversationId: invitation.conversation_id,
                    action: { kind: 'join', invitation_id: invitation.id },
                  });
                  complete(receipt);
                },
              })
            }
          >
            Accept invitation
          </button>
        </article>
      ))}
      {after && <button onClick={() => setAfter(undefined)}>First received invitations</button>}
      {inbox.value?.next && (
        <button onClick={() => setAfter(inbox.value!.next!)}>More received invitations</button>
      )}
      <button onClick={inbox.reload}>Refresh invitations</button>
    </section>
  );
}
