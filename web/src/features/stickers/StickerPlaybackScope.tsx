import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { reserveAnimationPlayback, type StickerPlaybackGroup } from './stickerPlayback';

const PlaybackGroupContext = createContext<StickerPlaybackGroup>('default');

interface StickerPlaybackScopeProps {
  group: Exclude<StickerPlaybackGroup, 'default'>;
  isActive?: boolean;
  children: ReactNode;
}

/** Pause background stickers while an active pack or held preview owns playback. */
export function StickerPlaybackScope({
  group,
  isActive = true,
  children,
}: StickerPlaybackScopeProps) {
  useLayoutEffect(() => {
    if (!isActive) {
      return;
    }

    return reserveAnimationPlayback(group);
  }, [group, isActive]);

  return <PlaybackGroupContext.Provider value={group}>{children}</PlaybackGroupContext.Provider>;
}

/** Preserve a sticker's playback group through React portals. */
export function useStickerPlaybackGroup() {
  return useContext(PlaybackGroupContext);
}
