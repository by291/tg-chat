/** Give one audible media element playback ownership while leaving muted previews running. */
export function pauseOtherMedia(activeMedia: HTMLMediaElement) {
  const mediaElements = document.querySelectorAll<HTMLMediaElement>('audio, video');
  for (const media of mediaElements) {
    if (media !== activeMedia && !media.muted && !media.paused) {
      media.pause();
    }
  }
}
