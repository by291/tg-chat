import { useEffect, useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { UserPlus } from 'lucide-react';
import { ToastViewport } from '@/components/Toast';
import { SettingsHeader } from '@/features/settings/SettingsControls';
import { DevicesSettingsPage } from '@/features/settings/devices/DevicesSettingsPage';
import { OperatorWorkspace } from '@/features/operator/OperatorWorkspace';
import { AccountPreferencesPanel } from '@/features/settings/connected/AccountPreferencesPanel';
import { ConnectedStickerPackScope } from '@/features/settings/connected/StickerPackScope';
import { BrowserPushSettings } from '@/features/settings/notifications/BrowserPushSettings';
import {
  resolveNotificationTarget,
  takeNotificationTarget,
} from '@/features/settings/notifications/notificationNavigation';
import { SessionOwner, isCancelled } from '../auth/SessionOwner';
import { CommunityInviteLink } from '../communities/CommunityAdmission';
import { CommunityWorkspace } from '../communities/CommunityWorkspace';
import {
  conversationDestination,
  type CommunityKind,
  type Conversation,
} from '../communities/communityModels';
import { connectionStatusLabel } from '../chat/data/connectionStatus';
import { ConnectedChat } from '../chat/connected/ConnectedChat';
import { CallPanel } from '../calls/CallPanel';
import { AccountSettingsHome, type SettingsPage } from './AccountSettingsHome';
import { ContactsPanel } from './ContactsPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { ProfilePanel } from './ProfilePanel';
import { SecurityPanel } from './SecurityPanel';
import { useWorkspaceConnections } from './useWorkspaceConnections';
import styles from './Accounts.module.css';

type CommunityView = 'discover' | 'invitations' | CommunityKind;

type Page =
  | SettingsPage
  | 'messages'
  | 'settings'
  | 'contacts'
  | 'contact-search'
  | 'blocks'
  | 'security'
  | 'communities';

interface WorkspaceProps {
  owner: SessionOwner;
  auth: components['schemas']['AuthResponse'];
  capabilities: components['schemas']['Capabilities'];
}

const COMMUNITY_PAGE_TITLES: Record<CommunityView, string> = {
  discover: 'Communities',
  invitations: 'Communities',
  group: 'New Group',
  channel: 'New Channel',
};

const SUBPAGE_NAVIGATION = {
  profile: {
    title: 'Edit Profile',
    parent: 'settings',
    backLabel: 'Back to settings',
  },
  'contact-search': {
    title: 'Find people',
    parent: 'contacts',
    backLabel: 'Back to contacts',
  },
  blocks: {
    title: 'Blocked users',
    parent: 'privacy',
    backLabel: 'Back to privacy and security',
  },
  security: {
    title: 'Password & recovery',
    parent: 'privacy',
    backLabel: 'Back to privacy and security',
  },
  preferences: {
    title: 'Preferences',
    parent: 'settings',
    backLabel: 'Back to settings',
  },
  operator: {
    title: 'Administration',
    parent: 'settings',
    backLabel: 'Back to settings',
  },
} as const;

function initialPage(capabilities: WorkspaceProps['capabilities']): Page {
  return capabilities.messaging_available ? 'messages' : 'settings';
}

/** Keep authenticated ownership separate from demo state and persistence. */
export function AccountWorkspace({ owner, auth, capabilities }: WorkspaceProps) {
  const [page, setPage] = useState<Page>(() => initialPage(capabilities));
  const [conversationRequest, setConversationRequest] = useState(0);
  const [communityView, setCommunityView] = useState<CommunityView>('discover');
  const [chatError, setChatError] = useState('');
  const { preferences, revision } = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const areCallsAvailable = capabilities.calls_available;
  const { activity, push, calls, canUseCalls, chat, startup, retryChat } = useWorkspaceConnections({
    owner,
    revision,
    areCallsAvailable,
    isMessagingAvailable: capabilities.messaging_available,
  });

  useEffect(() => {
    if (!chat) {
      return;
    }

    let navigation = 0;

    async function openNotification() {
      const target = takeNotificationTarget();
      if (!target || !chat) {
        return;
      }

      const request = ++navigation;
      chat.showInbox();
      setPage('messages');
      const conversation = await resolveNotificationTarget({ target, session: owner, chat });

      // Leave a newer user selection in place if notification lookup finishes after navigation.
      const isCurrent = navigation === request && owner.getSnapshot().revision === revision;
      if (!isCurrent || !conversation || chat.getSnapshot().selection) {
        return;
      }

      await chat.select({
        destination: conversationDestination(conversation),
        title: conversation.title || conversation.peer_name,
      });
    }

    function navigate() {
      void openNotification().catch((error: unknown) => {
        if (!isCancelled(error)) {
          setChatError(error instanceof Error ? error.message : 'The conversation is unavailable.');
        }
      });
    }

    navigate();
    window.addEventListener('hashchange', navigate);
    return () => {
      navigation += 1;
      window.removeEventListener('hashchange', navigate);
    };
  }, [chat, owner, revision]);

  useEffect(() => {
    if (page === 'preferences' && !preferences) {
      void owner.refreshAccountSettings().catch(() => undefined);
    }
  }, [owner, page, preferences]);

  function startChat(person: components['schemas']['PublicProfile']) {
    if (!chat) {
      return;
    }
    void chat
      .select({
        destination: { kind: 'recipient', user_id: person.id },
        title: person.display_name,
      })
      .catch((error: unknown) => {
        if (!isCancelled(error)) {
          setChatError(error instanceof Error ? error.message : 'Chat could not be opened.');
        }
      });
    setConversationRequest((current) => current + 1);
    setPage('messages');
  }

  function openCommunity(conversation: Conversation) {
    if (!chat) {
      return;
    }
    setChatError('');
    void chat
      .select({ destination: conversationDestination(conversation), title: conversation.title })
      .then(() => {
        setPage('messages');
        setConversationRequest((current) => current + 1);
      })
      .catch((error: unknown) => {
        if (!isCancelled(error)) {
          setChatError(error instanceof Error ? error.message : 'The community is unavailable.');
        }
      });
  }

  function showCommunities(view: CommunityView = 'discover') {
    setCommunityView(view);
    setPage('communities');
  }

  const profile = auth.user;
  let content;
  switch (page) {
    case 'settings':
      content = (
        <AccountSettingsHome
          owner={owner}
          profile={profile}
          onOpenPage={setPage}
          onBack={capabilities.messaging_available ? () => setPage('messages') : undefined}
          onOpenContacts={chat ? undefined : () => setPage('contacts')}
        />
      );
      break;
    case 'messages': {
      const startupStatus = connectionStatusLabel(startup?.connectionStatus ?? 'ready');
      const startupError = startup?.startupError;
      content = (
        <div className={styles.panel}>
          {startupStatus && <p role="status">{startupStatus}</p>}
          {!startupStatus && !startupError && <p role="status">Loading conversations…</p>}
          {startupError && (
            <>
              <p role="alert" className={styles.error}>
                {startupError}
              </p>
              <button type="button" onClick={retryChat}>
                Retry loading chats
              </button>
            </>
          )}
          <button type="button" className={styles.textButton} onClick={() => setPage('settings')}>
            Account settings
          </button>
        </div>
      );
      break;
    }
    case 'preferences':
      content = (
        <>
          <AccountPreferencesPanel
            preferences={preferences ?? null}
            onUpdate={(input) => owner.updateAccountPreferences(input)}
          />
          <BrowserPushSettings owner={push} />
        </>
      );
      break;
    case 'operator':
      content = profile.is_operator ? <OperatorWorkspace owner={owner} /> : null;
      break;
    case 'communities':
      content = chat ? (
        <CommunityWorkspace
          session={owner}
          chat={chat}
          view={communityView}
          onShowInvitations={() => setCommunityView('invitations')}
          onShowDiscovery={() => setCommunityView('discover')}
          onOpen={openCommunity}
        />
      ) : (
        <p role="status">Connecting to communities…</p>
      );
      break;
    case 'privacy':
      content = (
        <PrivacyPanel
          owner={owner}
          settingsVersion={preferences?.version}
          onBack={() => setPage('settings')}
          onOpenBlocked={() => setPage('blocks')}
          onOpenSecurity={() => setPage('security')}
        />
      );
      break;
    case 'devices':
      content = <DevicesSettingsPage onBack={() => setPage('settings')} connected={{ owner }} />;
      break;
    case 'contacts':
      content = (
        <>
          <SettingsHeader
            title="Contacts"
            backLabel="Back to chats"
            onBack={() => setPage('messages')}
          >
            <button
              type="button"
              className={styles.headerAction}
              aria-label="Add contact"
              onClick={() => setPage('contact-search')}
            >
              <UserPlus size={22} aria-hidden="true" />
            </button>
          </SettingsHeader>
          <ContactsPanel
            owner={owner}
            scope="contacts"
            onStartChat={chat ? startChat : undefined}
          />
        </>
      );
      break;
    case 'contact-search':
      content = (
        <ContactsPanel owner={owner} scope="search" onStartChat={chat ? startChat : undefined} />
      );
      break;
    case 'blocks':
      content = <ContactsPanel owner={owner} scope="blocks" />;
      break;
    case 'security':
      content = (
        <SecurityPanel
          owner={owner}
          profile={profile}
          isEmailAvailable={capabilities.email_recovery_available}
        />
      );
      break;
    default:
      content = (
        <ProfilePanel
          owner={owner}
          profile={profile}
          isAvatarAvailable={capabilities.avatars_available}
        />
      );
  }

  const subpage =
    page in SUBPAGE_NAVIGATION
      ? SUBPAGE_NAVIGATION[page as keyof typeof SUBPAGE_NAVIGATION]
      : undefined;
  const accountPage = (
    <div className={styles.accountPage} key={page}>
      {subpage && (
        <SettingsHeader
          title={subpage.title}
          backLabel={subpage.backLabel}
          onBack={() => setPage(subpage.parent)}
        />
      )}
      {page === 'communities' && (
        <SettingsHeader
          title={COMMUNITY_PAGE_TITLES[communityView]}
          backLabel="Back to chats"
          onBack={() => setPage('messages')}
        />
      )}
      {chatError && (
        <p role="alert" className={styles.error}>
          {chatError}
        </p>
      )}
      {content}
    </div>
  );
  const callPanel = canUseCalls ? (
    <CallPanel key="call-panel" owner={calls} isChatOpen={page === 'messages' && Boolean(chat)} />
  ) : null;

  const inviteLink = chat && (
    <CommunityInviteLink session={owner} chat={chat} onAdmitted={openCommunity} />
  );

  if (chat && page !== 'operator') {
    return (
      <>
        <ConnectedStickerPackScope packIds={preferences?.sticker_pack_ids}>
          <ConnectedChat
            owner={chat}
            session={owner}
            activity={activity}
            calls={canUseCalls ? calls : undefined}
            areCallsAvailable={areCallsAvailable}
            user={profile}
            isMediaAvailable={capabilities.media_uploads_available === true}
            isAvatarAvailable={capabilities.avatars_available}
            accountPage={page === 'messages' ? undefined : accountPage}
            conversationRequest={conversationRequest}
            onSettings={() => setPage('settings')}
            onContacts={() => setPage('contacts')}
            onCommunities={() => showCommunities()}
            onCreateCommunity={showCommunities}
            onOpenCommunity={openCommunity}
          />
          <ToastViewport />
        </ConnectedStickerPackScope>
        {callPanel}
        {inviteLink}
      </>
    );
  }

  return (
    <>
      <main className={styles.standaloneAccount}>{accountPage}</main>
      <ToastViewport />
      {callPanel}
      {inviteLink}
    </>
  );
}
