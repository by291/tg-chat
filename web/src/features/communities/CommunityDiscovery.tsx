import { useCallback, useState } from 'react';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { AccountForm, Field, textField, useOperation } from '@/features/accounts/AccountForm';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import type { Conversation } from './communityModels';
import styles from '@/features/accounts/Accounts.module.css';

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
