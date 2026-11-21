import { LogOut, Search } from 'lucide-react';
import type { components } from '@/api/schema';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { avatarUrl } from '@/features/media/mediaAccess';
import { useAuthorizedMediaUrl } from '@/features/media/useAuthorizedMediaUrl';
import { SettingsProfile } from '@/features/settings/profile/SettingsProfile';
import { SettingsAccountDetails } from '@/features/settings/profile/SettingsAccountDetails';
import { SettingsSearchResults } from '@/features/settings/SettingsSearchPanel';
import { accountSettingsCatalog, type SettingsPage } from './accountSettingsCatalog';
import searchStyles from '@/features/settings/SettingsSearchPanel.module.css';
import settingsStyles from '@/features/settings/SettingsPage.module.css';
import { SettingsHeader, SettingsRow } from '@/features/settings/SettingsControls';
import type { SessionOwner } from '../auth/SessionOwner';
import { useOperation } from './AccountForm';
import styles from './Accounts.module.css';

const INITIALS_LENGTH = 2;

interface AccountSettingsHomeProps {
  owner: SessionOwner;
  profile: components['schemas']['PrivateProfile'];
  onOpenPage: (
    page: SettingsPage,
    options?: {
      settingsPage?: 'wallpaper' | 'power';
      settingsItem?: string;
    },
  ) => void;
  isSearching: boolean;
  isCovered: boolean;
  onSetSearch: (options: { shouldOpen: boolean }) => void;
  onBack?: () => void;
  onOpenContacts?: () => void;
}

/** Show the signed-in profile and the entry points to connected settings. */
export function AccountSettingsHome({
  owner,
  profile,
  onOpenPage,
  isSearching,
  isCovered,
  onSetSearch,
  onBack,
  onOpenContacts,
}: AccountSettingsHomeProps) {
  const logout = useOperation();

  const authorize = useCallback(
    (signal: AbortSignal) => {
      // prettier-ignore
      return avatarUrl({
        session: owner,
        owner: 'user',
        id: profile.id,
        signal,
      });
    },
    [owner, profile.id],
  );
  const photo = useAuthorizedMediaUrl({ key: profile.avatar_file_id ?? undefined, authorize });
  const searchButton = useRef<HTMLButtonElement>(null);
  const wasSearching = useRef(isSearching);
  useLayoutEffect(() => {
    if (wasSearching.current && !isSearching && !isCovered) {
      searchButton.current?.focus({ preventScroll: true });
    }
    wasSearching.current = isSearching;
  }, [isSearching, isCovered]);

  const [recentIds, setRecentIds] = useState<string[]>([]);
  const { entries, catalog, search } = accountSettingsCatalog(profile);
  const searchAction = (
    <IconButton
      ref={searchButton}
      label="Search settings"
      onClick={() => onSetSearch({ shouldOpen: true })}
    >
      <Search />
    </IconButton>
  );
  const header = onBack ? (
    <SettingsHeader title="Settings" backLabel="Back to chats" onBack={onBack}>
      {searchAction}
    </SettingsHeader>
  ) : (
    <header className={settingsStyles.header}>
      <h2>Settings</h2>
      {searchAction}
    </header>
  );

  return (
    <section className={searchStyles.layers} data-searching={isSearching} aria-label="Settings">
      <div className={searchStyles.mainLayer} inert={isSearching} aria-hidden={isSearching}>
        <SettingsProfile
          header={header}
          identity={{
            name: profile.display_name,
            initials: profile.display_name.slice(0, INITIALS_LENGTH).toUpperCase(),
            photoUrl: photo.url,
            subtitle: `@${profile.username}`,
          }}
        >
          <SettingsAccountDetails profile={profile} />
          <nav className={settingsStyles.section} aria-label="Account settings">
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
        </SettingsProfile>
      </div>
      <SettingsSearchResults
        isOpen={isSearching}
        isCovered={isCovered}
        search={search}
        categoryFor={(entry) => entry}
        recent={recentIds.flatMap((id) => catalog.filter((item) => item.id === id))}
        onClose={() => onSetSearch({ shouldOpen: false })}
        onSelect={(item) => {
          setRecentIds((previous) => [item.id, ...previous.filter((id) => id !== item.id)]);
          onOpenPage(item.page, { settingsPage: item.subpage, settingsItem: item.anchorId });
        }}
      />
    </section>
  );
}
