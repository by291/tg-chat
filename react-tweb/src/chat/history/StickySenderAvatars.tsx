import { Avatar } from '../../components/Avatar';
import { useSenderProfile } from '../details/SenderProfileProvider';
import type { HistorySenderGroup } from './historySenderGroups';
import styles from './StickySenderAvatars.module.css';

interface StickySenderAvatarsProps {
  groups: HistorySenderGroup[];
  isSelecting: boolean;
  isPreview: boolean;
}

/** Keep sender avatars clickable within the full group's native sticky bounds. */
export function StickySenderAvatars({ groups, isSelecting, isPreview }: StickySenderAvatarsProps) {
  const profiles = useSenderProfile();
  const canOpenProfile = Boolean(profiles) && !isSelecting && !isPreview;
  const AvatarElement = canOpenProfile ? 'button' : 'span';

  return groups.map((group) => {
    const peer = profiles?.getPeer(group);
    return (
      <div
        key={group.key}
        className={styles.senderGroup}
        data-sender-group={group.key}
        data-selecting={isSelecting}
        data-preview={isPreview}
        style={{ top: group.start, height: group.end - group.start }}
      >
        <AvatarElement
          className={styles.avatar}
          type={canOpenProfile ? 'button' : undefined}
          aria-label={canOpenProfile ? `Open profile for ${group.authorName}` : undefined}
          aria-hidden={canOpenProfile ? undefined : true}
          onClick={canOpenProfile ? () => profiles?.openProfile(group) : undefined}
        >
          <Avatar
            initials={peer?.initials ?? group.authorName.slice(0, 1)}
            color={peer?.color ?? 'pink'}
          />
        </AvatarElement>
      </div>
    );
  });
}
