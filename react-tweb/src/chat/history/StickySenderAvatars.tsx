import type { HistorySenderGroup } from './historySenderGroups';
import styles from './StickySenderAvatars.module.css';

interface StickySenderAvatarsProps {
  groups: HistorySenderGroup[];
  isSelecting: boolean;
  isPreview: boolean;
}

/** Let each sender group's measured bounds constrain its native sticky avatar. */
export function StickySenderAvatars({ groups, isSelecting, isPreview }: StickySenderAvatarsProps) {
  return groups.map((group) => (
    <div
      key={group.key}
      className={styles.senderGroup}
      data-sender-group={group.key}
      data-selecting={isSelecting}
      data-preview={isPreview}
      style={{ top: group.start, height: group.end - group.start }}
      aria-hidden="true"
    >
      <span className={styles.avatar}>{group.authorName.slice(0, 1)}</span>
    </div>
  ));
}
