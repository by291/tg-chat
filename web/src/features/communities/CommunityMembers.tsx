import { useCallback, useState } from 'react';
import { requirePayload } from '@/features/auth/SessionOwner';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { useOperation } from '@/features/accounts/AccountForm';
import type { CommunityPanelProps, CommunityAction } from './communityModels';
import styles from '@/features/accounts/Accounts.module.css';

const MUTE_DAY_MS = 24 * 60 * 60 * 1000;

/** Show only server-authorized members and enforce role boundaries in available management controls. */
export function CommunityMembers(props: CommunityPanelProps) {
  const [after, setAfter] = useState<string>();
  const operation = useOperation();
  const load = useCallback(async () => {
    const reply = await props.session.client.GET('/api/v1/communities/{conversation_id}/members', {
      params: {
        path: { conversation_id: props.conversation.id },
        query: { after },
      },
    });
    return requirePayload(reply);
  }, [props.session, props.conversation.id, props.conversation.version, after]);
  const members = useAccountResource(load);
  const currentUserId = props.session.getSnapshot().auth?.user.id;
  const isOwner = props.conversation.role === 'owner';

  function change(action: CommunityAction) {
    void operation.run({ operation: () => props.command(action) });
  }

  return (
    <section className={styles.card} aria-label="Community members">
      <h3>{props.conversation.kind === 'channel' ? 'Subscribers' : 'Members'}</h3>
      {props.conversation.kind === 'channel' && !props.conversation.can_manage && (
        <p>Only administrators can view other subscribers.</p>
      )}
      {(members.error || operation.error) && <p role="alert">{members.error || operation.error}</p>}
      {members.value?.items.map((member) => {
        const isSelf = member.id === currentUserId;
        const canModerate =
          props.conversation.can_manage &&
          !isSelf &&
          member.role !== 'owner' &&
          (isOwner || member.role === 'member');
        const isMuted = Boolean(
          member.posting_muted_until && Date.parse(member.posting_muted_until) > Date.now(),
        );
        return (
          <article key={member.id} className={styles.card} aria-label={`Member ${member.username}`}>
            <strong>{member.display_name}</strong>
            <p>
              @{member.username} · {member.role}
              {member.is_banned ? ' · banned' : ''}
            </p>
            {canModerate && (
              <div className={styles.rowActions}>
                {member.is_banned ? (
                  <button
                    disabled={operation.isPending}
                    onClick={() => change({ kind: 'unban', user_id: member.id })}
                  >
                    Unban
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        props.confirm({
                          title: 'Remove member?',
                          description: 'This removes access to retained history.',
                          action: { kind: 'remove', user_id: member.id },
                        })
                      }
                    >
                      Remove
                    </button>
                    <button
                      onClick={() =>
                        props.confirm({
                          title: 'Ban member?',
                          description: 'This removes access and blocks joining until unbanned.',
                          action: { kind: 'ban', user_id: member.id },
                        })
                      }
                    >
                      Ban
                    </button>
                    {props.conversation.kind === 'group' && (
                      <button
                        disabled={operation.isPending}
                        onClick={() =>
                          change({
                            kind: 'mute',
                            user_id: member.id,
                            until: isMuted
                              ? null
                              : new Date(Date.now() + MUTE_DAY_MS).toISOString(),
                          })
                        }
                      >
                        {isMuted ? 'Allow posting' : 'Mute posting for one day'}
                      </button>
                    )}
                    {isOwner && (
                      <>
                        <button
                          disabled={operation.isPending}
                          onClick={() =>
                            change({
                              kind: 'role',
                              user_id: member.id,
                              role: member.role === 'admin' ? 'member' : 'admin',
                            })
                          }
                        >
                          {member.role === 'admin' ? 'Remove administrator' : 'Make administrator'}
                        </button>
                        <button
                          onClick={() =>
                            props.confirm({
                              title: 'Transfer ownership?',
                              description:
                                'You will become an administrator. Only the new owner can transfer ownership again.',
                              action: { kind: 'transfer', user_id: member.id },
                            })
                          }
                        >
                          Transfer ownership
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        );
      })}
      <div className={styles.rowActions}>
        {after && <button onClick={() => setAfter(undefined)}>First members</button>}
        {members.value?.next && (
          <button onClick={() => setAfter(members.value!.next!)}>More members</button>
        )}
      </div>
    </section>
  );
}
