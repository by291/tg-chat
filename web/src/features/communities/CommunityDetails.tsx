import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Link2,
  Settings,
  Shield,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconButton } from '@/components/IconButton';
import overlays from '@/components/overlays/overlays.module.css';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { useOperation } from '@/features/accounts/AccountForm';
import {
  ActionConfirmation,
  type Confirmation,
} from '@/features/chat/connected/ActionConfirmation';
import { AvatarEditor } from '@/features/media/AvatarEditor';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import accountStyles from '@/features/accounts/Accounts.module.css';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';
import { CommunityMembers } from './CommunityMembers';
import { CommunityInvitations, CommunityRequests } from './CommunityInvitations';
import {
  communityAudienceLabel,
  type CommunityAction,
  type CommunityPanelProps,
  type Conversation,
} from './communityModels';
import styles from './CommunityProfile.module.css';

type ProfilePage =
  'members' | 'settings' | 'administrators' | 'banned' | 'requests' | 'invitations';

interface ProfileSection {
  page: ProfilePage;
  label: string;
  icon: LucideIcon;
}

interface CommunityDetailsProps {
  session: SessionOwner;
  chat: ChatOwner;
  id: string;
  isAvatarAvailable?: boolean;
  onBack: () => void;
}

interface SettingsEditorProps extends CommunityPanelProps {
  isAvatarAvailable?: boolean;
}

interface CommunityOverviewProps extends CommunityPanelProps {
  onNavigate: (page: ProfilePage) => void;
}

function profileSections(conversation: Conversation): ProfileSection[] {
  const sections: ProfileSection[] = [];
  const isChannel = conversation.kind === 'channel';
  if (!isChannel || conversation.can_manage) {
    sections.push({ page: 'members', label: isChannel ? 'Subscribers' : 'Members', icon: Users });
  }
  if (conversation.can_manage) {
    sections.push(
      { page: 'settings', label: 'Community settings', icon: Settings },
      { page: 'administrators', label: 'Administrators', icon: Shield },
      { page: 'banned', label: 'Banned users', icon: UserX },
      { page: 'requests', label: 'Join requests', icon: ClipboardList },
      { page: 'invitations', label: 'Invite links', icon: Link2 },
    );
  }
  return sections;
}

function CommunitySettingsEditor(props: SettingsEditorProps) {
  // Capture metadata with its revision so a remote update cannot silently replace a local edit.
  const [baseline, setBaseline] = useState(props.conversation);
  const [formRevision, setFormRevision] = useState(0);
  const hasRemoteChanges = baseline.settings_version !== props.conversation.settings_version;
  const conversation = props.conversation;

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

  async function assignAvatar(fileId: string | null) {
    await props.command({
      kind: 'avatar',
      expected_version: conversation.settings_version,
      file_id: fileId,
    });
    // The avatar has its own action but shares the settings revision.
    if (!hasRemoteChanges) {
      setBaseline({
        ...baseline,
        avatar_file_id: fileId,
        settings_version: (BigInt(conversation.settings_version) + 1n).toString(),
      });
    }
  }

  return (
    <section className={`${accountStyles.card} ${styles.sectionCard}`}>
      {props.isAvatarAvailable && (
        <AvatarEditor
          session={props.session}
          owner="conversation"
          id={conversation.id}
          fileId={conversation.avatar_file_id}
          initials={conversation.title.slice(0, 2).toUpperCase()}
          onAssign={assignAvatar}
        />
      )}
      {hasRemoteChanges && (
        <div role="status">
          <p>Settings changed elsewhere. Your edits are preserved; reload before editing again.</p>
          <button
            type="button"
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

function CommunityOverview({ session, conversation, confirm, onNavigate }: CommunityOverviewProps) {
  const clipboard = useOperation();
  const publicHandle = conversation.is_public && conversation.public_handle;
  const sections = profileSections(conversation);
  const audience = communityAudienceLabel({
    kind: conversation.kind === 'channel' ? 'channel' : 'group',
    memberCount: conversation.member_count,
  });

  function copyHandle() {
    if (!publicHandle) {
      return;
    }
    void clipboard.run({
      operation: () => navigator.clipboard.writeText(`@${publicHandle}`),
      successMessage: 'Public handle copied.',
    });
  }

  function leave() {
    if (conversation.role === 'owner') {
      confirm({
        title: 'Delete community for everyone?',
        description: 'All members will lose access. This cannot be undone.',
        action: { kind: 'delete' },
      });
      return;
    }
    confirm({
      title: 'Leave community?',
      description: 'You will lose access to its retained history until admitted again.',
      action: { kind: 'leave' },
    });
  }

  return (
    <>
      <div className={styles.identity}>
        <RemoteAvatar
          session={session}
          owner="conversation"
          id={conversation.id}
          fileId={conversation.avatar_file_id}
          initials={conversation.title.slice(0, 2).toUpperCase()}
          size="large"
        />
        <h2>{conversation.title}</h2>
        <p>{audience}</p>
      </div>
      <dl className={styles.facts}>
        {conversation.description && (
          <div className={styles.fact}>
            <dt>About</dt>
            <dd>{conversation.description}</dd>
          </div>
        )}
        {publicHandle && (
          <div className={styles.fact}>
            <dt>Public handle</dt>
            <dd className={styles.handle}>
              <span>@{publicHandle}</span>
              <IconButton
                label="Copy public handle"
                disabled={clipboard.isPending}
                onClick={copyHandle}
              >
                <Copy />
              </IconButton>
            </dd>
          </div>
        )}
      </dl>
      {clipboard.error && <p role="alert">{clipboard.error}</p>}
      {clipboard.notice && <p role="status">{clipboard.notice}</p>}
      {sections.length > 0 && (
        <nav className={styles.profileNav} aria-label="Community information and management">
          {sections.map(({ page, label, icon: Icon }) => (
            <button
              type="button"
              key={page}
              className={styles.navItem}
              data-profile-section={page}
              onClick={() => onNavigate(page)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ))}
        </nav>
      )}
      <button type="button" className={`${overlays.textButton} ${styles.danger}`} onClick={leave}>
        {conversation.role === 'owner' ? 'Delete community' : 'Leave community'}
      </button>
    </>
  );
}

function ProfilePageBody({ page, ...props }: SettingsEditorProps & { page: ProfilePage }) {
  switch (page) {
    case 'members':
    case 'administrators':
    case 'banned':
      return <CommunityMembers {...props} view={page} />;
    case 'settings':
      return <CommunitySettingsEditor {...props} />;
    case 'requests':
      return <CommunityRequests {...props} />;
    case 'invitations':
      return <CommunityInvitations {...props} />;
  }
}

/** Keep the open profile and its actions bound to the current admitted conversation. */
export function CommunityDetails(props: CommunityDetailsProps) {
  const snapshot = useSyncExternalStore(props.chat.subscribe, props.chat.getSnapshot);
  const conversation = snapshot.conversations.find((entry) => entry.id === props.id);
  const [page, setPage] = useState<ProfilePage>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const details = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const lastSection = useRef<ProfilePage>(undefined);
  const operation = useOperation();
  const activeSection =
    conversation && profileSections(conversation).find((entry) => entry.page === page);
  const activePage = activeSection?.page;

  useEffect(() => {
    if (activePage) {
      lastSection.current = activePage;
      section.current?.focus();
      return;
    }

    if (lastSection.current) {
      const selector = `[data-profile-section="${lastSection.current}"]`;
      details.current?.querySelector<HTMLButtonElement>(selector)?.focus();
      lastSection.current = undefined;
    }
  }, [activePage]);

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
    return <p role="status">This community is no longer available to your account.</p>;
  }

  const panel = {
    session: props.session,
    conversation,
    command,
    confirm,
  };
  const sectionHasHeading = activePage === 'invitations' || activePage === 'requests';

  return (
    <div className={styles.details} ref={details}>
      {activeSection && (
        <button type="button" className={styles.back} onClick={() => setPage(undefined)}>
          <ArrowLeft size={20} aria-hidden="true" />
          Back to community info
        </button>
      )}
      {activeSection ? (
        <section ref={section} aria-label={activeSection.label} tabIndex={-1}>
          {!sectionHasHeading && <h3 className={styles.subpageHeading}>{activeSection.label}</h3>}
          <ProfilePageBody
            key={activeSection.page}
            {...panel}
            page={activeSection.page}
            isAvatarAvailable={props.isAvatarAvailable}
          />
        </section>
      ) : (
        <CommunityOverview {...panel} onNavigate={setPage} />
      )}
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
