import { Gavel, LogOut, Shield, SlidersHorizontal, Smartphone, UserRound } from 'lucide-react';
import type { components } from '@/api/schema';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import { SettingsHeader, SettingsRow } from '@/features/settings/SettingsControls';
import type { SessionOwner } from '../auth/SessionOwner';
import { useOperation } from './AccountForm';
import styles from './Accounts.module.css';

const SETTINGS_ENTRIES = [
  {
    page: 'profile',
    label: 'Edit Profile',
    icon: UserRound,
    color: 'blue',
  },
  {
    page: 'privacy',
    label: 'Privacy and Security',
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

export type SettingsPage = (typeof SETTINGS_ENTRIES)[number]['page'];

interface AccountSettingsHomeProps {
  owner: SessionOwner;
  profile: components['schemas']['PrivateProfile'];
  onOpenPage: (page: SettingsPage) => void;
  onBack?: () => void;
  onOpenContacts?: () => void;
}

/** Show the signed-in profile and the entry points to connected settings. */
export function AccountSettingsHome({
  owner,
  profile,
  onOpenPage,
  onBack,
  onOpenContacts,
}: AccountSettingsHomeProps) {
  const logout = useOperation();
  const entries = SETTINGS_ENTRIES.filter((entry) => {
    return entry.page !== 'operator' || profile.is_operator;
  });

  return (
    <>
      {onBack ? (
        <SettingsHeader title="Settings" backLabel="Back to chats" onBack={onBack} />
      ) : (
        <h2 className={styles.standaloneTitle}>Settings</h2>
      )}
      <div className={styles.identity}>
        <RemoteAvatar
          session={owner}
          owner="user"
          id={profile.id}
          fileId={profile.avatar_file_id}
          initials={profile.display_name.slice(0, 2).toUpperCase()}
          size="large"
        />
        <div>
          <h3>{profile.display_name}</h3>
          <p>@{profile.username}</p>
        </div>
      </div>
      <nav className={styles.settingsGroup} aria-label="Account settings">
        {entries.map(({ page, label, icon, color }) => (
          <SettingsRow
            key={page}
            label={label}
            icon={icon}
            color={color}
            onClick={() => onOpenPage(page)}
          />
        ))}
        {onOpenContacts && (
          <button type="button" className={styles.textButton} onClick={onOpenContacts}>
            Contacts
          </button>
        )}
      </nav>
      <div className={styles.panel}>
        <button
          type="button"
          className={styles.textButton}
          disabled={logout.isPending}
          onClick={() => void logout.run({ operation: () => owner.logout() })}
        >
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
        {logout.error && (
          <p role="alert" className={styles.error}>
            {logout.error}
          </p>
        )}
      </div>
    </>
  );
}
