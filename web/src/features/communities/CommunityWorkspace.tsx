import { useSyncExternalStore } from 'react';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { useOperation } from '@/features/accounts/AccountForm';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';
import { CommunityDiscovery } from './CommunityDiscovery';
import { CommunityAdmission } from './CommunityAdmission';
import type { CommunityOperations } from './CommunityOperations';
import type { CommunityKind, Conversation } from './communityModels';
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

interface CommunityWorkspaceProps {
  session: SessionOwner;
  chat: ChatOwner;
  view: 'discover' | 'invitations' | CommunityKind;
  onShowInvitations: () => void;
  onShowDiscovery: () => void;
  onOpen: (conversation: Conversation) => void;
}

/** Keep discovery, invitations, and the kind-specific create flow in the chat sidebar. */
export function CommunityWorkspace(props: CommunityWorkspaceProps) {
  const { chat, session, view } = props;
  const operations = chat.communities;
  const isCreating = view === 'group' || view === 'channel';
  const admission = { session, chat, onAdmitted: props.onOpen };

  return (
    <div className={`${styles.panel} ${communityStyles.workspace}`}>
      {operations && <CommunityRecovery operations={operations} />}
      {isCreating && operations && (
        <CommunitySettingsForm
          key={view}
          creationKind={view}
          onSubmit={async (fields) => {
            const receipt = await operations.create({
              ...readCommunitySettings(fields),
              kind: view,
            });
            if (receipt.conversation) {
              props.onOpen(receipt.conversation);
            }
          }}
        />
      )}
      {!isCreating && (
        <>
          <nav className={communityStyles.navigation} aria-label="Community pages">
            <button
              type="button"
              aria-pressed={view === 'discover'}
              onClick={props.onShowDiscovery}
            >
              Discover
            </button>
            <button
              type="button"
              aria-pressed={view === 'invitations'}
              onClick={props.onShowInvitations}
            >
              Invitations
            </button>
          </nav>
          {view === 'discover' && <CommunityDiscovery {...admission} />}
          {view === 'invitations' && <CommunityAdmission {...admission} />}
        </>
      )}
    </div>
  );
}
