import { Bookmark } from 'lucide-react';
import styles from './primitives.module.css';

interface AvatarProps {
  initials: string;
  color?: string;
  size?: 'small' | 'normal' | 'large';
  src?: string;
}

/** Render a profile thumbnail or the initials fallback. */
export function Avatar({ initials, color = 'blue', size = 'normal', src }: AvatarProps) {
  return (
    <span className={styles.avatar} data-color={color} data-size={size} aria-hidden="true">
      {src ? (
        <img src={src} alt="" crossOrigin="anonymous" className={styles.avatarPhoto} />
      ) : initials === 'saved' ? (
        <Bookmark fill="currentColor" />
      ) : (
        initials
      )}
    </span>
  );
}
