import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import { useAppPreferences } from '../appPreferences';
import { loadStickerAnimation } from '@/features/stickers/loadStickerAnimation';
import styles from './ThemeSettings.module.css';

const PLAYBACK_DELAY = 250;
const THEME_EMOJI: Record<string, string> = {
  default: '1f3e0',
  diamond: '1f48e',
  rose: '1f338',
  peach: '1f9e1',
  green: '1f33f',
  lavender: '1f49c',
  forest: '1f332',
  ocean: '1f499',
  sunset: '1f31e',
};

interface ThemeEmojiProps {
  themeId: string;
  fallback: string;
  isPlaying: boolean;
  onComplete: () => void;
}

/** Enlarge a selected Telegram emoji, play one animation, and settle back at its resting size. */
export function ThemeEmoji({ themeId, fallback, isPlaying, onComplete }: ThemeEmojiProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<AnimationItem | undefined>(undefined);
  const completeRef = useRef(onComplete);
  const [isReady, setIsReady] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldAnimateStickers = useAppPreferences(
    (preferences) => preferences.shouldAnimateStickers,
  );
  completeRef.current = onComplete;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const target = container;
    let isDisposed = false;
    async function loadEmoji() {
      try {
        const animationData = await loadStickerAnimation(
          `/assets/theme-emoji/${THEME_EMOJI[themeId]}.tgs`,
        );
        const playerModule = await import('lottie-web/build/player/lottie_light');
        if (isDisposed) {
          return;
        }
        const player = playerModule.default.loadAnimation({
          container: target,
          renderer: 'svg',
          loop: false,
          autoplay: false,
          animationData: structuredClone(animationData),
        });
        playerRef.current = player;
        player.addEventListener('DOMLoaded', () => setIsReady(true));
        player.addEventListener('complete', () => {
          setIsExpanded(false);
          completeRef.current();
        });
      } catch (error) {
        console.warn('Could not load theme emoji.', error);
        // A missing decorative asset must not block selecting its theme.
        if (!isDisposed) {
          completeRef.current();
        }
      }
    }
    void loadEmoji();
    return () => {
      isDisposed = true;
      playerRef.current?.destroy();
      playerRef.current = undefined;
    };
  }, [themeId]);

  useEffect(
    () => {
      const player = playerRef.current;
      const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const canPlay = isPlaying && isReady && shouldAnimateStickers && !shouldReduceMotion;
      setIsExpanded(canPlay);
      if (!player || !canPlay) {
        player?.pause();
        return;
      }
      player.goToAndStop(0, true);
      const timer = window.setTimeout(() => player.play(), PLAYBACK_DELAY);
      return () => {
        window.clearTimeout(timer);
        player.pause();
      };
    },
    // prettier-ignore
    [
    isPlaying,
    isReady,
    shouldAnimateStickers,
  ],
  );

  return (
    <span className={styles.emoji} data-expanded={isExpanded} aria-hidden="true">
      <span ref={containerRef} className={styles.emojiArtwork} />
      {!isReady && fallback}
    </span>
  );
}
