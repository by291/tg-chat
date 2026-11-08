import {
  ContactRound,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Shield,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import { ToastViewport } from '@/components/Toast';
import { SettingsRow } from '@/features/settings/SettingsControls';
import { DevicesSettingsPage } from '@/features/settings/devices/DevicesSettingsPage';
import { SessionOwner, isCancelled } from '../auth/SessionOwner';
import { ChatOwner } from '../chat/data/ChatOwner';
import { ConnectedChat } from '../chat/connected/ConnectedChat';
import { useOperation } from './AccountForm';
import { ContactsPanel } from './ContactsPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { ProfilePanel } from './ProfilePanel';
import { SecurityPanel } from './SecurityPanel';
import styles from './Accounts.module.css';

type Page = 'messages' | 'profile' | 'privacy' | 'devices' | 'contacts' | 'security';

interface WorkspaceProps {
  owner: SessionOwner;
  auth: components['schemas']['AuthResponse'];
  capabilities: components['schemas']['Capabilities'];
}

const NAVIGATION = [
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
] as const;

/** Keep the authenticated workspace separate from demo conversation state and browser persistence. */
export function AccountWorkspace({ owner, auth, capabilities }: WorkspaceProps) {
  const [page, setPage] = useState<Page>('profile');
  const action = useOperation();
  const [chat, setChat] = useState<ChatOwner>();
  const [chatError, setChatError] = useState('');

  useEffect(() => {
    if (!capabilities.messaging_available) {
      return;
    }
    const connected = new ChatOwner({ session: owner });
    let disconnect: (() => void) | undefined;
    void connected
      .start()
      .then(() => {
        setChat(connected);
        disconnect = connected.connect();
        void connected.flush();
      })
      .catch((error: unknown) => {
        if (!isCancelled(error)) {
          setChatError(error instanceof Error ? error.message : 'Chat could not be loaded.');
        }
      });

    return () => {
      disconnect?.();
      connected.dispose();
    };
  }, [owner, capabilities.messaging_available]);

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

  if (page === 'messages' && chat) {
    return (
      <ConnectedChat
        owner={chat}
        user={auth.user}
        onSettings={() => setPage('profile')}
        onFindPeople={() => setPage('contacts')}
      />
    );
  }

  const profile = auth.user;
  let content;
  switch (page) {
    case 'privacy':
      content = <PrivacyPanel owner={owner} />;
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
      content = <ProfilePanel owner={owner} profile={profile} />;
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
            {NAVIGATION.filter((entry) => entry.page !== 'messages' || Boolean(chat)).map(
              (entry) => (
                <div key={entry.page} aria-current={entry.page === page ? 'page' : undefined}>
                  <SettingsRow
                    label={entry.label}
                    icon={entry.icon}
                    color={entry.color}
                    onClick={() => setPage(entry.page)}
                  />
                </div>
              ),
            )}
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
