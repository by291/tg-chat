import { Menu } from '@ark-ui/react/menu';
import { Ellipsis } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import overlays from '@/components/overlays/overlays.module.css';
import type { components } from '@/api/schema';
import { requirePayload } from '@/features/auth/SessionOwner';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { useOperation } from '@/features/accounts/AccountForm';
import type { CommunityPanelProps, CommunityAction } from './communityModels';
import styles from './CommunityProfile.module.css';

const MUTE_DAY_MS = 24 * 60 * 60 * 1000;

type Member = components['schemas']['CommunityMember'];
type MemberView = 'members' | 'administrators' | 'banned';
type MemberConfirmation = Parameters<CommunityPanelProps['confirm']>[0];

interface MemberAction {
  label: string;
  action: CommunityAction;
  confirmation?: Omit<MemberConfirmation, 'action'>;
  isDestructive?: boolean;
}

interface MemberActionsProps {
  member: Member;
  conversation: CommunityPanelProps['conversation'];
  isPending: boolean;
  onChange: (action: CommunityAction) => void;
  onConfirm: CommunityPanelProps['confirm'];
}

function memberActions({ member, conversation }: MemberActionsProps): MemberAction[] {
  if (member.is_banned) {
    return [{ label: 'Unban', action: { kind: 'unban', user_id: member.id } }];
  }

  const actions: MemberAction[] = [
    {
      label: 'Remove',
      action: { kind: 'remove', user_id: member.id },
      confirmation: {
        title: 'Remove member?',
        description: 'This removes access to retained history.',
      },
      isDestructive: true,
    },
    {
      label: 'Ban',
      action: { kind: 'ban', user_id: member.id },
      confirmation: {
        title: 'Ban member?',
        description: 'This removes access and blocks joining until unbanned.',
      },
      isDestructive: true,
    },
  ];

  if (conversation.kind === 'group') {
    const mutedUntil = member.posting_muted_until;
    const isMuted = Boolean(mutedUntil && Date.parse(mutedUntil) > Date.now());
    const until = isMuted ? null : new Date(Date.now() + MUTE_DAY_MS).toISOString();
    actions.unshift({
      label: isMuted ? 'Allow posting' : 'Mute posting for one day',
      action: { kind: 'mute', user_id: member.id, until },
    });
  }

  if (conversation.role === 'owner') {
    const isAdministrator = member.role === 'admin';
    actions.unshift(
      {
        label: isAdministrator ? 'Remove administrator' : 'Make administrator',
        action: { kind: 'role', user_id: member.id, role: isAdministrator ? 'member' : 'admin' },
      },
      {
        label: 'Transfer ownership',
        action: { kind: 'transfer', user_id: member.id },
        confirmation: {
          title: 'Transfer ownership?',
          description:
            'You will become an administrator. Only the new owner can transfer ownership again.',
        },
      },
    );
  }

  return actions;
}

function MemberActions(props: MemberActionsProps) {
  function select(kind: CommunityAction['kind']) {
    // Recompute timed restrictions when the moderator chooses the action.
    const entry = memberActions(props).find((candidate) => candidate.action.kind === kind);
    if (!entry) {
      return;
    }
    if (entry.confirmation) {
      props.onConfirm({ ...entry.confirmation, action: entry.action });
      return;
    }
    props.onChange(entry.action);
  }

  return (
    <Menu.Root positioning={{ placement: 'bottom-end', strategy: 'fixed', gutter: 6 }}>
      <Menu.Trigger asChild>
        <IconButton label={`Actions for ${props.member.display_name}`} disabled={props.isPending}>
          <Ellipsis />
        </IconButton>
      </Menu.Trigger>
      {/* Keep member actions inside the profile dialog’s pointer and focus boundary. */}
      <Menu.Positioner className={styles.memberMenu}>
        <Menu.Content className={overlays.menu}>
          {memberActions(props).map((entry) => (
            <Menu.Item
              key={entry.action.kind}
              value={entry.action.kind}
              className={
                entry.isDestructive ? `${overlays.menuItem} ${overlays.danger}` : overlays.menuItem
              }
              onSelect={() => select(entry.action.kind)}
            >
              {entry.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

function matchesView(member: Member, view: MemberView): boolean {
  if (view === 'banned') {
    return member.is_banned;
  }
  if (!member.is_active || member.is_banned) {
    return false;
  }
  return view === 'members' || member.role === 'admin' || member.role === 'owner';
}

function memberRole(role: string): string | undefined {
  if (role === 'owner') {
    return 'Owner';
  }
  if (role === 'admin') {
    return 'Administrator';
  }
  return undefined;
}

interface CommunityMembersProps extends CommunityPanelProps {
  view: MemberView;
}

/** Show a paged roster within the selected management view and current account permissions. */
export function CommunityMembers(props: CommunityMembersProps) {
  const { session, conversation, view } = props;
  const [after, setAfter] = useState<string>();
  const operation = useOperation();
  const canInspectRoster = conversation.kind !== 'channel' || conversation.can_manage;
  const load = useCallback(async () => {
    // A demoted channel administrator must never keep their previous subscriber results.
    if (!canInspectRoster) {
      return { items: [], next: null };
    }
    const reply = await session.client.GET('/api/v1/communities/{conversation_id}/members', {
      params: {
        path: { conversation_id: conversation.id },
        query: { after },
      },
    });
    return requirePayload(reply);
  }, [session, conversation.id, canInspectRoster, after]);
  const members = useAccountResource(load, conversation.version);
  const currentUserId = session.getSnapshot().auth?.user.id;
  const isOwner = conversation.role === 'owner';
  const visibleMembers = members.value?.items.filter((member) => matchesView(member, view)) ?? [];
  const nextPage = members.value?.next;

  function change(action: CommunityAction) {
    void operation.run({ operation: () => props.command(action) });
  }

  if (!canInspectRoster || (view !== 'members' && !conversation.can_manage)) {
    return null;
  }

  return (
    <section className={styles.members} aria-label="Community members">
      {members.isLoading && <p role="status">Loading people…</p>}
      {(members.error || operation.error) && <p role="alert">{members.error || operation.error}</p>}
      {!members.isLoading && !members.error && visibleMembers.length === 0 && (
        <p>{after || nextPage ? 'No matching people on this page.' : 'No people to show.'}</p>
      )}
      {visibleMembers.map((member) => {
        const isSelf = member.id === currentUserId;
        const canModerate =
          conversation.can_manage &&
          !isSelf &&
          member.role !== 'owner' &&
          (isOwner || member.role === 'member');
        const role = memberRole(member.role);
        return (
          <article
            key={member.id}
            className={styles.member}
            aria-label={`Member ${member.username}`}
          >
            <Avatar initials={member.display_name.slice(0, 2).toUpperCase()} size="small" />
            <div className={styles.memberName}>
              <strong>{member.display_name}</strong>
              <span>@{member.username}</span>
            </div>
            {role && <span className={styles.role}>{role}</span>}
            {canModerate && (
              <MemberActions
                member={member}
                conversation={conversation}
                isPending={operation.isPending}
                onChange={change}
                onConfirm={props.confirm}
              />
            )}
          </article>
        );
      })}
      <div className={styles.pagination}>
        {after && (
          <button type="button" className={overlays.textButton} onClick={() => setAfter(undefined)}>
            First people
          </button>
        )}
        {nextPage && (
          <button type="button" className={overlays.textButton} onClick={() => setAfter(nextPage)}>
            More people
          </button>
        )}
      </div>
    </section>
  );
}
