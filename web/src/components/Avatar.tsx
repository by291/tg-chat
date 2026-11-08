import { Bookmark } from 'lucide-react';
import styles from './primitives.module.css';

interface AvatarProps {
  initials: string;
  color?: string;
  size?: 'small' | 'normal' | 'large';
}

/** Render a deterministic avatar without fetching private profile photos. */
export function Avatar({ initials, color = 'blue', size = 'normal' }: AvatarProps) {
  return (
    <span className={styles.avatar} data-color={color} data-size={size} aria-hidden="true">
      {initials === 'saved' ? <Bookmark fill="currentColor" /> : initials}
    </span>
  );
}
