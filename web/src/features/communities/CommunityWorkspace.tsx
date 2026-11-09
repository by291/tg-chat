import { useState, useSyncExternalStore } from 'react';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { textField, useOperation } from '@/features/accounts/AccountForm';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';
import { CommunityDetails } from './CommunityDetails';
import { CommunityAdmission, CommunityDiscovery } from './CommunityDiscovery';
import type { CommunityOperations } from './CommunityOperations';
import type { Conversation } from './communityModels';
import styles from '@/features/accounts/Accounts.module.css';
import communityStyles from './Communities.module.css';

function CommunityRecovery({ operations }: { operations: CommunityOperations }) {
  const pending = useSyncExternalStore(operations.subscribe, operations.getSnapshot);
  const operation = useOperation();
  if (pending.length === 0) {
    return null;
  }
  return (
    <section className={styles.card} aria-label="Unconfirmed community actions">
      <h2>Unconfirmed community actions</h2>
      <p>Review current membership before retrying. Dismissal does not cancel a server change.</p>
      {operation.error && <p role="alert">{operation.error}</p>}
      {pending.map((entry) => {
        const action = entry.kind === 'command' ? entry.request.action : undefined;
        const token = action?.kind === 'invite' ? action.token : undefined;
        const link = token ? `${window.location.origin}/#invite=${token}` : undefined;
        return (
          <article key={entry.request.operation_id}>
            <p>
              {action?.kind ?? 'create'} · {entry.request.conversation_id}
            </p>
            {link && (
              <p>
                Recoverable invitation: <a href={link}>{link}</a>
              </p>
            )}
            <button
              disabled={operation.isPending}
              onClick={() =>
                void operation.run({
                  operation: async () => {
                    await operations.retry(entry.request.operation_id);
                  },
                })
              }
            >
              Retry community action
            </button>
            <button
              disabled={operation.isPending}
              onClick={() =>
                void operation.run({
                  operation: () => operations.dismiss(entry.request.operation_id),
                })
              }
            >
              Dismiss community action
            </button>
          </article>
        );
      })}
    </section>
  );
}

/** Connect discovery, explicit admission, creation, and authorized community management. */
export function CommunityWorkspace(props: {
  session: SessionOwner;
  chat: ChatOwner;
  initialId?: string;
  onOpen: (conversation: Conversation) => void;
}) {
  const [selectedId, setSelectedId] = useState(props.initialId);
  const snapshot = useSyncExternalStore(props.chat.subscribe, props.chat.getSnapshot);
  const communities = snapshot.conversations.filter(
    (conversation) => conversation.kind === 'group' || conversation.kind === 'channel',
  );
  const admission = {
    session: props.session,
    chat: props.chat,
    onAdmitted: (conversation: Conversation) => setSelectedId(conversation.id),
  };

  return (
    <div className={`${styles.panel} ${communityStyles.workspace}`}>
      {props.chat.communities && <CommunityRecovery operations={props.chat.communities} />}
      {selectedId ? (
        <CommunityDetails
          key={selectedId}
          session={props.session}
          chat={props.chat}
          id={selectedId}
          onBack={() => setSelectedId(undefined)}
          onOpen={props.onOpen}
        />
      ) : (
        <>
          <section className={styles.card}>
            <h1>Communities</h1>
            <h2>Your groups and channels</h2>
            {communities.length === 0 && <p>You have not joined any communities.</p>}
            {communities.map((conversation) => (
              <button key={conversation.id} onClick={() => setSelectedId(conversation.id)}>
                {conversation.title} · {conversation.kind} · {conversation.role}
              </button>
            ))}
          </section>
          <CommunityDiscovery {...admission} />
          <CommunityAdmission {...admission} />
          <section className={styles.card}>
            <h2>Create a group or channel</h2>
            <CommunitySettingsForm
              isCreating
              onSubmit={async (fields) => {
                const receipt = await props.chat.communities!.create({
                  ...readCommunitySettings(fields),
                  kind: textField(fields, 'kind'),
                });
                if (receipt.conversation) {
                  setSelectedId(receipt.conversation.id);
                }
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}
