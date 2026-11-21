import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { components } from '@/api/schema';
import { UserPlus } from 'lucide-react';
import { ToastViewport } from '@/components/Toast';
import { SettingsHeader } from '@/features/settings/SettingsControls';
import { DevicesPanel } from './DevicesPanel';
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
import { conversationDestination, type Conversation } from '../communities/communityModels';
import { connectionStatusLabel } from '../chat/data/connectionStatus';
import { ConnectedChat } from '../chat/connected/ConnectedChat';
import { CallPanel } from '../calls/CallPanel';
import { AccountSettingsHome } from './AccountSettingsHome';
import { ContactsPanel } from './ContactsPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { ProfilePanel } from './ProfilePanel';
import { SecurityPanel } from './SecurityPanel';
import { useWorkspaceConnections } from './useWorkspaceConnections';
import { GeneralSettingsPage } from '../settings/GeneralSettingsPage';
import { KeyboardSettingsPage } from '../settings/keyboard/KeyboardSettingsPage';
import {
  accountPagePath,
  useAccountNavigation,
  type AccountPage,
  type CommunityView,
} from './useAccountNavigation';
import { AccountPageLayers } from './AccountPageLayers';
import styles from './Accounts.module.css';

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
    backLabel: 'Back to settings',
  },
  'contact-search': {
    title: 'Find people',
    backLabel: 'Back to contacts',
  },
  blocks: {
    title: 'Blocked users',
    backLabel: 'Back to privacy and security',
  },
  security: {
    title: 'Password & recovery',
    backLabel: 'Back to privacy and security',
  },
  preferences: {
    title: 'Preferences',
    backLabel: 'Back to settings',
  },
  operator: {
    title: 'Administration',
    backLabel: 'Back to settings',
  },
} as const;

/** Keep authenticated ownership separate from demo state and persistence. */
export function AccountWorkspace({ owner, auth, capabilities }: WorkspaceProps) {
  const navigation = useAccountNavigation({
    isMessagingAvailable: capabilities.messaging_available,
  });
  const { page, communityView, openPage, goBack } = navigation;
  const showNotificationInbox = useEffectEvent(navigation.openNotificationInbox);
  const showNotificationChat = useEffectEvent(() => navigation.openConversation());
  const operatorRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (page === 'operator') {
      operatorRef.current?.querySelector('button')?.focus({ preventScroll: true });
    }
  }, [page]);
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

    let notificationGeneration = 0;

    async function openNotification() {
      const target = takeNotificationTarget();
      if (!target || !chat) {
        return;
      }

      const request = ++notificationGeneration;
      chat.showInbox();
      const isInboxCurrent = showNotificationInbox();
      const conversation = await resolveNotificationTarget({ target, session: owner, chat });

      // Leave a newer user selection in place if notification lookup finishes after navigation.
      const isCurrent =
        notificationGeneration === request && owner.getSnapshot().revision === revision;
      if (!isCurrent || !isInboxCurrent() || !conversation || chat.getSnapshot().selection) {
        return;
      }

      // Admit the route before asynchronous history work so its completion cannot steal focus.
      showNotificationChat();
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
      notificationGeneration += 1;
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
    navigation.openConversation();
  }

  function openCommunity(conversation: Conversation) {
    if (!chat) {
      return;
    }
    setChatError('');
    navigation.openConversation();
    void chat
      .select({ destination: conversationDestination(conversation), title: conversation.title })
      .catch((error: unknown) => {
        if (!isCancelled(error)) {
          setChatError(error instanceof Error ? error.message : 'The community is unavailable.');
        }
      });
  }

  function showCommunities(view: CommunityView = 'discover') {
    if (view === 'invitations') {
      openPage('invitations');
      return;
    }
    openPage('communities', { view });
  }

  const profile = auth.user;
  function renderPage(currentPage: AccountPage) {
    let content;
    switch (currentPage) {
      case 'settings':
        content = (
          <AccountSettingsHome
            owner={owner}
            profile={profile}
            onOpenPage={openPage}
            onBack={capabilities.messaging_available ? goBack : undefined}
            onOpenContacts={chat ? undefined : () => openPage('contacts')}
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
            <button
              type="button"
              className={styles.textButton}
              onClick={() => openPage('settings')}
            >
              Account settings
            </button>
          </div>
        );
        break;
      }
      case 'general':
        content = <GeneralSettingsPage onBack={goBack} />;
        break;
      case 'shortcuts':
        content = <KeyboardSettingsPage onBack={goBack} />;
        break;
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
      case 'invitations':
        content = chat ? (
          <CommunityWorkspace
            session={owner}
            chat={chat}
            view={currentPage === 'invitations' ? 'invitations' : communityView}
            onShowInvitations={() => showCommunities('invitations')}
            onShowDiscovery={() => {
              if (currentPage === 'invitations') {
                goBack();
              }
            }}
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
            navigation={navigation.detail}
            onBack={goBack}
            onOpenBlocked={() => openPage('blocks')}
            onOpenSecurity={() => openPage('security')}
          />
        );
        break;
      case 'devices':
        content = <DevicesPanel onBack={goBack} owner={owner} navigation={navigation.detail} />;
        break;
      case 'contacts':
        content = (
          <>
            <SettingsHeader title="Contacts" backLabel="Back to chats" onBack={goBack}>
              <button
                type="button"
                className={styles.headerAction}
                aria-label="Add contact"
                onClick={() => openPage('contact-search')}
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
      currentPage in SUBPAGE_NAVIGATION
        ? SUBPAGE_NAVIGATION[currentPage as keyof typeof SUBPAGE_NAVIGATION]
        : undefined;
    return (
      <div className={styles.accountPage} data-page={currentPage}>
        {subpage && (
          <SettingsHeader title={subpage.title} backLabel={subpage.backLabel} onBack={goBack} />
        )}
        {(currentPage === 'communities' || currentPage === 'invitations') && (
          <SettingsHeader
            title={COMMUNITY_PAGE_TITLES[communityView]}
            backLabel={currentPage === 'invitations' ? 'Back to communities' : 'Back to chats'}
            onBack={goBack}
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
  }

  const path = accountPagePath(page);
  if (!capabilities.messaging_available && path[0] !== 'settings') {
    path.unshift('settings');
  }
  const isOperatorOpen = page === 'operator' && Boolean(chat);
  const accountPage = (
    <AccountPageLayers
      key={path[0]}
      path={path}
      renderPage={(entry) => (entry === 'operator' && chat ? null : renderPage(entry))}
    />
  );
  const callPanel = canUseCalls ? (
    <CallPanel key="call-panel" owner={calls} isChatOpen={page === 'messages' && Boolean(chat)} />
  ) : null;

  const inviteLink = chat && (
    <CommunityInviteLink session={owner} chat={chat} onAdmitted={openCommunity} />
  );

  if (chat) {
    return (
      <>
        <ConnectedStickerPackScope packIds={preferences?.sticker_pack_ids}>
          <div hidden={isOperatorOpen}>
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
              isConversationOpen={navigation.isChatOpen}
              isWorkspaceHidden={isOperatorOpen}
              onShowConversation={navigation.openConversation}
              onShowDirectory={navigation.closeConversation}
              onSettings={() => openPage('settings')}
              onContacts={() => openPage('contacts')}
              onCommunities={() => showCommunities()}
              onCreateCommunity={showCommunities}
              onOpenCommunity={openCommunity}
            />
          </div>
          {isOperatorOpen && (
            <main className={styles.standaloneAccount} ref={operatorRef}>
              {renderPage('operator')}
            </main>
          )}
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
