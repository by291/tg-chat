import { useSyncExternalStore } from 'react';

// prettier-ignore
const VOICE_PLAYBACK_RATES = [
  0.5,
  1,
  1.5,
  2,
] as const;
const DEFAULT_VOICE_RATE = 1;

let voicePlaybackRate: (typeof VOICE_PLAYBACK_RATES)[number] = DEFAULT_VOICE_RATE;
const voiceRateListeners = new Set<() => void>();

function subscribeVoiceRate(listener: () => void) {
  voiceRateListeners.add(listener);
  return () => {
    voiceRateListeners.delete(listener);
  };
}

function getVoicePlaybackRate() {
  return voicePlaybackRate;
}

/** Read the tab's voice rate independently of mounted history rows. */
export function useVoicePlaybackRate() {
  return useSyncExternalStore(subscribeVoiceRate, getVoicePlaybackRate);
}

/** Advance every voice player to the next supported playback rate. */
export function cycleVoicePlaybackRate() {
  const index = VOICE_PLAYBACK_RATES.indexOf(voicePlaybackRate);
  voicePlaybackRate = VOICE_PLAYBACK_RATES[(index + 1) % VOICE_PLAYBACK_RATES.length];
  for (const listener of voiceRateListeners) {
    listener();
  }
}

/** Give one audible media element playback ownership while leaving muted previews running. */
export function pauseOtherMedia(activeMedia: HTMLMediaElement) {
  const mediaElements = document.querySelectorAll<HTMLMediaElement>('audio, video');
  for (const media of mediaElements) {
    if (media !== activeMedia && !media.muted && !media.paused) {
      media.pause();
    }
  }
}
