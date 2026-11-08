import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import { useExpandableProfile } from './useExpandableProfile';
import styles from './SettingsProfile.module.css';

interface ProfileIdentity {
  name: string;
  initials: string;
  photoUrl?: string;
}

interface SettingsProfileProps {
  identity: ProfileIdentity;
  header: ReactNode;
  children: ReactNode;
}

/** Morph a loaded profile photo between the centered avatar and a full-width settings cover. */
export function SettingsProfile({ identity, header, children }: SettingsProfileProps) {
  const [loadedPhoto, setLoadedPhoto] = useState<string>();
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const hasPhoto = Boolean(identity.photoUrl && loadedPhoto === identity.photoUrl);
  const canLoadPhoto = identity.photoUrl && failedPhoto !== identity.photoUrl;
  const profile = useExpandableProfile({ isEnabled: hasPhoto });

  return (
    <div
      ref={profile.pageRef}
      className={styles.page}
      data-expanded={profile.isExpanded}
      data-scrolled={profile.hasScrolled}
    >
      <div className={styles.header}>{header}</div>
      <div
        ref={profile.scrollRef}
        className={styles.scroll}
        role="region"
        aria-label="Settings content"
      >
        <div className={styles.profile}>
          <div className={styles.photo} data-ready={hasPhoto}>
            {canLoadPhoto && (
              <img
                src={identity.photoUrl}
                alt="Your profile photo"
                draggable={false}
                onLoad={() => setLoadedPhoto(identity.photoUrl)}
                onError={() => {
                  setLoadedPhoto(undefined);
                  setFailedPhoto(identity.photoUrl);
                }}
              />
            )}
          </div>
          {!hasPhoto && (
            <div className={styles.fallback}>
              <Avatar initials={identity.initials} color="purple" size="large" />
            </div>
          )}
          <div className={styles.shade} />
          {hasPhoto && (
            <button
              type="button"
              className={styles.expand}
              aria-label="Expand profile photo"
              aria-expanded={profile.isExpanded}
              onClick={profile.expandPhoto}
            />
          )}
          <div className={styles.identity}>
            <h3>{identity.name}</h3>
            <p>online</p>
          </div>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
