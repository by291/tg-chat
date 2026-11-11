import {
  ContactRound,
  Gavel,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Shield,
  SlidersHorizontal,
  Smartphone,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import { ToastViewport } from '@/components/Toast';
import { SettingsRow } from '@/features/settings/SettingsControls';
import { DevicesSettingsPage } from '@/features/settings/devices/DevicesSettingsPage';
import { OperatorWorkspace } from '@/features/operator/OperatorWorkspace';
import { AccountPreferencesPanel } from '@/features/settings/connected/AccountPreferencesPanel';
import { ConnectedStickerPackScope } from '@/features/settings/connected/StickerPackScope';
import { BrowserPushOwner } from '@/features/settings/notifications/BrowserPushOwner';
import { BrowserPushSettings } from '@/features/settings/notifications/BrowserPushSettings';
import {
  resolveNotificationTarget,
  takeNotificationTarget,
} from '@/features/settings/notifications/notificationNavigation';
import { SessionOwner, isCancelled } from '../auth/SessionOwner';
import { CommunityWorkspace } from '../communities/CommunityWorkspace';
import { conversationDestination, type Conversation } from '../communities/communityModels';
import { ChatOwner } from '../chat/data/ChatOwner';
import { ConnectedChat } from '../chat/connected/ConnectedChat';
import { ActivityOwner } from '../chat/activity/ActivityOwner';
import { useOperation } from './AccountForm';
import { ContactsPanel } from './ContactsPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { ProfilePanel } from './ProfilePanel';
import { SecurityPanel } from './SecurityPanel';
import styles from './Accounts.module.css';

type Page =
  | 'messages'
  | 'profile'
  | 'privacy'
  | 'devices'
  | 'contacts'
  | 'security'
  | 'communities'
  | 'preferences'
  | 'operator';

interface WorkspaceProps {
  owner: SessionOwner;
  auth: components['schemas']['AuthResponse'];
  capabilities: components['schemas']['Capabilities'];
}

const NAVIGATION = [
  {
    page: 'communities',
    label: 'Communities',
    icon: Users,
    color: 'blue',
  },
  {
    page: 'messages',
    label: 'Messages',
    icon: MessageCircle,
    color: 'blue',
  },
  {
    page: 'profile',
    label: 'Profile',
    icon: UserRound,
    color: 'blue',
  },
  {
    page: 'privacy',
    label: 'Privacy',
    icon: Shield,
    color: 'green',
  },
  {
    page: 'devices',
    label: 'Devices',
    icon: Smartphone,
    color: 'purple',
  },
  {
    page: 'contacts',
    label: 'Contacts & blocks',
    icon: ContactRound,
    color: 'blue',
  },
  {
    page: 'security',
    label: 'Password & recovery',
    icon: LockKeyhole,
    color: 'purple',
  },
  {
    page: 'preferences',
    label: 'Preferences',
    icon: SlidersHorizontal,
    color: 'blue',
  },
  {
    page: 'operator',
    label: 'Administration',
    icon: Gavel,
    color: 'blue',
  },
] as const;

/** Keep authenticated ownership separate from demo state and persistence. */
export function AccountWorkspace({ owner, auth, capabilities }: WorkspaceProps) {
  const [page, setPage] = useState<Page>(
    window.location.hash.startsWith('#invite=') ? 'communities' : 'profile',
  );
  const action = useOperation();
  const [communityId, setCommunityId] = useState<string>();
  const [chat, setChat] = useState<ChatOwner>();
  const [chatError, setChatError] = useState('');
  const { preferences, revision } = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const [activity] = useState(() => new ActivityOwner({ session: owner }));
  const [push] = useState(() => new BrowserPushOwner({ session: owner }));

  useEffect(() => activity.connect(), [activity, revision]);
  useEffect(() => push.connect(), [push, revision]);

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

  useEffect(() => {
    if (!capabilities.messaging_available) {
      return;
    }

    let isCurrent = true;
    setChat(undefined);
    const connected = new ChatOwner({ session: owner });
    const disconnect = connected.connect({ onActivityHint: activity.refresh });
    void connected
      .start()
      .then(() => {
        if (!isCurrent) {
          return;
        }
        setChat(connected);
        void connected
          .catchUp()
          .then(() => connected.flush())
          .catch((error: unknown) => {
            if (!isCancelled(error)) {
              setChatError(error instanceof Error ? error.message : 'Chat synchronization failed.');
            }
          });
      })
      .catch((error: unknown) => {
        if (!isCancelled(error)) {
          setChatError(error instanceof Error ? error.message : 'Chat could not be loaded.');
        }
      });

    return () => {
      isCurrent = false;
      disconnect?.();
      connected.dispose();
    };
  }, [activity, owner, revision, capabilities.messaging_available]);

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
    setPage('messages');
  }

  function openCommunity(conversation: Conversation) {
    if (!chat) {
      return;
    }
    void action.run({
      operation: async () => {
        await chat.select({
          destination: conversationDestination(conversation),
          title: conversation.title,
        });
        setPage('messages');
      },
    });
  }

  function showCommunities(id?: string) {
    setCommunityId(id);
    setPage('communities');
  }

  if (page === 'messages' && chat) {
    return (
      <ConnectedStickerPackScope packIds={preferences?.sticker_pack_ids}>
        <ConnectedChat
          owner={chat}
          session={owner}
          activity={activity}
          user={auth.user}
          isMediaAvailable={capabilities.media_uploads_available === true}
          onSettings={() => setPage('profile')}
          onFindPeople={() => setPage('contacts')}
          onCommunities={() => showCommunities()}
          onCommunityDetails={showCommunities}
        />
        <ToastViewport />
      </ConnectedStickerPackScope>
    );
  }

  const profile = auth.user;
  let content;
  switch (page) {
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
          initialId={communityId}
          isAvatarAvailable={capabilities.avatars_available}
          onOpen={openCommunity}
        />
      ) : (
        <p role="status">Connecting to communities…</p>
      );
      break;
    case 'privacy':
      content = <PrivacyPanel owner={owner} settingsVersion={preferences?.version} />;
      break;
    case 'devices':
      content = <DevicesSettingsPage onBack={() => setPage('profile')} connected={{ owner }} />;
      break;
    case 'contacts':
      content = <ContactsPanel owner={owner} onStartChat={chat ? startChat : undefined} />;
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

  return (
    <>
      <main className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.identity}>
            <Avatar initials={profile.display_name.slice(0, 2).toUpperCase()} />
            <div>
              <h1>{profile.display_name}</h1>
              <p>@{profile.username}</p>
            </div>
          </div>
          <nav className={styles.navigation} aria-label="Account navigation">
            {NAVIGATION.filter((entry) => {
              if (entry.page === 'operator') {
                return profile.is_operator;
              }
              const needsChat = entry.page === 'messages' || entry.page === 'communities';
              return !needsChat || Boolean(chat);
            }).map((entry) => (
              <div key={entry.page} aria-current={entry.page === page ? 'page' : undefined}>
                <SettingsRow
                  label={entry.label}
                  icon={entry.icon}
                  color={entry.color}
                  onClick={() => {
                    setCommunityId(undefined);
                    setPage(entry.page);
                  }}
                />
              </div>
            ))}
          </nav>
          <div className={styles.sidebarFooter}>
            <button
              type="button"
              className={styles.textButton}
              disabled={action.isPending}
              onClick={() => void action.run({ operation: () => owner.logout() })}
            >
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
            {action.error && (
              <p role="alert" className={styles.error}>
                {action.error}
              </p>
            )}
            <p className={styles.hint}>
              Signed in on this server. Your private account data stays separate from the demo.
            </p>
          </div>
        </aside>
        <section className={styles.content} key={page} aria-label="Account page">
          {chatError && (
            <p role="alert" className={styles.error}>
              {chatError}
            </p>
          )}
          {content}
        </section>
      </main>
      <ToastViewport />
    </>
  );
}
