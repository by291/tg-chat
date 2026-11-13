import { Bookmark } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './primitives.module.css';

interface AvatarProps {
  initials: string;
  color?: string;
  size?: 'small' | 'normal' | 'large';
  src?: string;
}

/** Render a profile thumbnail or the initials fallback. */
export function Avatar({ initials, color = 'blue', size = 'normal', src }: AvatarProps) {
  let content: ReactNode = initials;
  if (src) {
    content = <img src={src} alt="" crossOrigin="anonymous" className={styles.avatarPhoto} />;
  } else if (initials === 'saved') {
    content = <Bookmark fill="currentColor" />;
  }

  return (
    <span className={styles.avatar} data-color={color} data-size={size} aria-hidden="true">
      {content}
    </span>
  );
}
