const STORAGE_KEY = 'react-tweb.sticker-playback.v1';

export type StickerPlaybackGroup = 'default' | 'pack' | 'preview';

interface PlaybackState {
  isWindowActive: boolean;
  isReducedMotion: boolean;
  shouldLoop: boolean;
  exclusiveGroup: StickerPlaybackGroup | undefined;
}

const listeners = new Set<() => void>();
const exclusiveGroups = new Map<symbol, StickerPlaybackGroup>();
let removeEnvironmentListeners: (() => void) | undefined;
let playbackState: PlaybackState = {
  isWindowActive: document.hasFocus() && !document.hidden,
  isReducedMotion: false,
  shouldLoop: readLoopPreference(),
  exclusiveGroup: undefined,
};

function readLoopPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function updatePlaybackState(changes: Partial<PlaybackState>) {
  playbackState = { ...playbackState, ...changes };
  for (const notify of listeners) {
    notify();
  }
}

function observeEnvironment() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function synchronizeEnvironment() {
    updatePlaybackState({
      isWindowActive: document.hasFocus() && !document.hidden,
      isReducedMotion: reducedMotion.matches,
    });
  }

  function synchronizeStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY || event.key === null) {
      updatePlaybackState({ shouldLoop: readLoopPreference() });
    }
  }

  window.addEventListener('focus', synchronizeEnvironment);
  window.addEventListener('blur', synchronizeEnvironment);
  window.addEventListener('storage', synchronizeStorage);
  document.addEventListener('visibilitychange', synchronizeEnvironment);
  reducedMotion.addEventListener('change', synchronizeEnvironment);
  synchronizeEnvironment();

  return () => {
    window.removeEventListener('focus', synchronizeEnvironment);
    window.removeEventListener('blur', synchronizeEnvironment);
    window.removeEventListener('storage', synchronizeStorage);
    document.removeEventListener('visibilitychange', synchronizeEnvironment);
    reducedMotion.removeEventListener('change', synchronizeEnvironment);
  };
}

function synchronizeExclusiveGroup() {
  const groups = Array.from(exclusiveGroups.values());
  // A held preview takes priority over its pack; closing it restores the still-open pack.
  if (groups.includes('preview')) {
    updatePlaybackState({ exclusiveGroup: 'preview' });
    return;
  }
  const exclusiveGroup = groups.includes('pack') ? 'pack' : undefined;
  updatePlaybackState({ exclusiveGroup });
}

/** Read the shared playback policy without creating a subscription per animation frame. */
export function getStickerPlaybackState() {
  return playbackState;
}

/** Share one set of window listeners across all mounted sticker players and settings. */
export function subscribeStickerPlayback(notify: () => void) {
  if (listeners.size === 0) {
    removeEnvironmentListeners = observeEnvironment();
  }
  listeners.add(notify);

  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      removeEnvironmentListeners?.();
      removeEnvironmentListeners = undefined;
    }
  };
}

/** Persist the loop preference and apply it to players already on screen. */
export function setStickerLoopPreference({ shouldLoop }: { shouldLoop: boolean }) {
  try {
    localStorage.setItem(STORAGE_KEY, String(shouldLoop));
  } catch {
    // Storage restrictions must not prevent changing playback for the current session.
  }
  updatePlaybackState({ shouldLoop });
}

/** Reserve playback for an overlay until its own cleanup releases the reservation. */
export function reserveStickerPlayback(group: Exclude<StickerPlaybackGroup, 'default'>) {
  const reservation = Symbol(group);
  exclusiveGroups.set(reservation, group);
  synchronizeExclusiveGroup();

  return () => {
    exclusiveGroups.delete(reservation);
    synchronizeExclusiveGroup();
  };
}
