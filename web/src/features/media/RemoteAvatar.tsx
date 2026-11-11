import { useCallback } from 'react';
import { Avatar } from '@/components/Avatar';
import type { components } from '@/api/schema';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { avatarUrl } from './mediaAccess';
import { useAuthorizedMediaUrl } from './useAuthorizedMediaUrl';

export interface RemoteAvatarProps {
  session: SessionOwner;
  owner: components['schemas']['AvatarOwner'];
  id: string;
  fileId?: string | null;
  initials: string;
  size?: 'small' | 'normal' | 'large';
}

/** Resolve a thumbnail for a visible identity and fall back to its initials. */
export function RemoteAvatar({ session, owner, id, fileId, initials, size }: RemoteAvatarProps) {
  const authorize = useCallback(
    (signal: AbortSignal) => avatarUrl({ session, owner, id, signal }),
    [session, owner, id],
  );
  const signed = useAuthorizedMediaUrl({ key: fileId ?? undefined, authorize });

  return <Avatar initials={initials} src={signed.url} size={size} />;
}
