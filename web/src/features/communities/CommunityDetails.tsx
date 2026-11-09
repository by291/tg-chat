import { useState, useSyncExternalStore } from 'react';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { useOperation } from '@/features/accounts/AccountForm';
import {
  ActionConfirmation,
  type Confirmation,
} from '@/features/chat/connected/ActionConfirmation';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';
import { CommunityMembers } from './CommunityMembers';
import { CommunityInvitations, CommunityRequests } from './CommunityInvitations';
import type { CommunityAction, CommunityPanelProps, Conversation } from './communityModels';
import styles from '@/features/accounts/Accounts.module.css';

function CommunitySettingsEditor(props: CommunityPanelProps) {
  // Capture metadata with its revision so a remote update cannot silently replace a local edit.
  const [baseline, setBaseline] = useState(props.conversation);
  const [formRevision, setFormRevision] = useState(0);
  const hasRemoteChanges = baseline.settings_version !== props.conversation.settings_version;

  async function save(fields: FormData) {
    const settings = readCommunitySettings(fields);
    await props.command({
      kind: 'settings',
      expected_version: baseline.settings_version,
      settings,
    });
    setBaseline({
      ...baseline,
      ...settings,
      settings_version: (BigInt(baseline.settings_version) + 1n).toString(),
    });
  }

  return (
    <section className={styles.card}>
      <h3>Community settings</h3>
      {hasRemoteChanges && (
        <div role="status">
          <p>Settings changed elsewhere. Your edits are preserved; reload before editing again.</p>
          <button
            onClick={() => {
              setBaseline(props.conversation);
              setFormRevision((revision) => revision + 1);
            }}
          >
            Discard edits and reload settings
          </button>
        </div>
      )}
      <CommunitySettingsForm key={formRevision} initial={baseline} onSubmit={save} />
    </section>
  );
}

/** Keep metadata, admission, and member management attached to current authorized projections. */
export function CommunityDetails(props: {
  session: SessionOwner;
  chat: ChatOwner;
  id: string;
  onBack: () => void;
  onOpen: (conversation: Conversation) => void;
}) {
  const snapshot = useSyncExternalStore(props.chat.subscribe, props.chat.getSnapshot);
  const conversation = snapshot.conversations.find((entry) => entry.id === props.id);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const operation = useOperation();

  async function command(action: CommunityAction) {
    const receipt = await props.chat.communities!.command({
      conversationId: props.id,
      action,
    });
    if (!receipt.conversation) {
      props.onBack();
    }
  }

  const confirm: CommunityPanelProps['confirm'] = (input) => {
    setConfirmation({
      title: input.title,
      description: input.description,
      choices: [{ label: 'Confirm', action: () => command(input.action) }],
    });
  };

  if (!conversation) {
    return (
      <section className={styles.card}>
        <button onClick={props.onBack}>Back to communities</button>
        <p role="status">This community is no longer available to your account.</p>
      </section>
    );
  }
  const panel = {
    session: props.session,
    conversation,
    command,
    confirm,
  };
  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <button onClick={props.onBack}>Back to communities</button>
        <h2>{conversation.title}</h2>
        <p>{conversation.description}</p>
        <p>
          {conversation.kind} · {conversation.is_public ? 'public' : 'private'} · Your role:{' '}
          {conversation.role}
        </p>
        <button onClick={() => props.onOpen(conversation)}>Open conversation</button>
      </section>
      {conversation.can_manage && <CommunitySettingsEditor {...panel} />}
      <CommunityMembers {...panel} />
      {conversation.can_manage && <CommunityRequests {...panel} />}
      {conversation.can_manage && <CommunityInvitations {...panel} />}
      <section className={styles.card}>
        {conversation.role === 'owner' ? (
          <>
            <p>Transfer ownership before leaving, or delete this community for everyone.</p>
            <button
              onClick={() =>
                confirm({
                  title: 'Delete community for everyone?',
                  description: 'All members will lose access. This cannot be undone.',
                  action: { kind: 'delete' },
                })
              }
            >
              Delete community
            </button>
          </>
        ) : (
          <button
            onClick={() =>
              confirm({
                title: 'Leave community?',
                description: 'You will lose access to its retained history until admitted again.',
                action: { kind: 'leave' },
              })
            }
          >
            Leave community
          </button>
        )}
      </section>
      {operation.error && <p role="alert">{operation.error}</p>}
      <ActionConfirmation
        confirmation={confirmation}
        isBusy={operation.isPending}
        onCancel={() => setConfirmation(undefined)}
        onChoose={(action) =>
          void operation.run({
            operation: async () => {
              await action();
              setConfirmation(undefined);
            },
          })
        }
      />
    </div>
  );
}
