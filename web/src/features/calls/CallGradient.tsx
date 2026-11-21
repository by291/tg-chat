import { WallpaperGradient } from '@/features/settings/appearance/WallpaperGradient';
import styles from './CallPanel.module.css';

const PALETTES = {
  // prettier-ignore
  connecting: [
    '#568fd6',
    '#626ed5',
    '#a667d5',
    '#7664da',
  ],
  // prettier-ignore
  active: [
    '#acbd65',
    '#459f8d',
    '#53a4d1',
    '#3e917a',
  ],
  // prettier-ignore
  weak: [
    '#c0508d',
    '#f09536',
    '#ce5081',
    '#fc7c4c',
  ],
};

export type CallTone = keyof typeof PALETTES;

/** Crossfade the call palettes over a persistent connecting background. */
export function CallGradient({ tone }: { tone: CallTone }) {
  return (
    <div className={styles.gradient} aria-hidden="true">
      <WallpaperGradient colors={PALETTES.connecting} />
      <div data-visible={tone === 'active'}>
        <WallpaperGradient colors={PALETTES.active} />
      </div>
      <div data-visible={tone === 'weak'}>
        <WallpaperGradient colors={PALETTES.weak} />
      </div>
    </div>
  );
}
