import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ThemeChoice } from './appearanceStore';
import { selectAppearanceMode, selectThemeChoice } from './appearanceActions';
import {
  ACCENT_COLORS,
  getThemePalette,
  getWallpaperAppearance,
  THEME_CARDS,
  THEME_VARIANTS,
} from './themeCatalog';
import { useResolvedAppearance } from './useAppearanceTheme';
import { WallpaperGradient } from './WallpaperGradient';
import { ThemeEmoji } from './ThemeEmoji';
import { SettingsRadio } from '../SettingsControls';
import settings from '../SettingsPage.module.css';
import styles from './ThemeSettings.module.css';

function scrollPickerToButton({
  button,
  alignment,
  behavior,
}: {
  button: HTMLButtonElement | null;
  alignment: 'center' | 'nearest';
  behavior: ScrollBehavior;
}) {
  const strip = button?.parentElement;
  if (!button || !strip) {
    return;
  }

  const stripBounds = strip.getBoundingClientRect();
  const buttonBounds = button.getBoundingClientRect();
  const buttonLeft = buttonBounds.left - stripBounds.left + strip.scrollLeft;
  const buttonRight = buttonLeft + buttonBounds.width;
  let left = strip.scrollLeft;
  if (alignment === 'center') {
    left = buttonLeft - (strip.clientWidth - buttonBounds.width) / 2;
  } else if (buttonLeft < left) {
    left = buttonLeft;
  } else if (buttonRight > left + strip.clientWidth) {
    left = buttonRight - strip.clientWidth;
  }

  // Sidebar pages stay mounted offscreen; scrolling ancestors would shift the whole app.
  strip.scrollTo?.({ left, behavior });
}

function movePickerFocus(event: KeyboardEvent<HTMLDivElement>) {
  // prettier-ignore
  const keys = [
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
  ];
  if (!keys.includes(event.key)) {
    return;
  }
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex = event.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
  if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = buttons.length - 1;
  }
  event.preventDefault();
  const button = buttons[(nextIndex + buttons.length) % buttons.length];
  button?.focus({ preventScroll: true });
  scrollPickerToButton({
    button,
    alignment: 'nearest',
    behavior: 'smooth',
  });
}

/** Select bundled color themes and brightness modes using Telegram's compact preview strip. */
export function ThemeSettings() {
  const { appearance, variant, choice } = useResolvedAppearance();
  const [playingTheme, setPlayingTheme] = useState<string>();
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    scrollPickerToButton({
      button: selectedRef.current,
      alignment: 'center',
      behavior: 'instant',
    });
  }, [variant]);

  function applyChoice(changes: Partial<ThemeChoice>) {
    void selectThemeChoice({ variant, changes });
  }

  return (
    <section className={settings.section} aria-label="Color theme">
      <h3>Color theme</h3>
      <div
        className={styles.themeStrip}
        role="toolbar"
        aria-label="Themes"
        onKeyDown={movePickerFocus}
      >
        {THEME_CARDS.map((theme) => {
          const previewChoice = {
            ...choice,
            themeId: theme.id,
            accent: null,
            wallpaper: null,
          } as ThemeChoice;
          const palette = getThemePalette({ variant, choice: previewChoice });
          const wallpaper = getWallpaperAppearance({ variant, choice: previewChoice });
          const isSelected = choice.themeId === theme.id && choice.accent === null;
          const previewStyle = {
            background: wallpaper.background,
            '--preview-incoming': palette.variables['--incoming-color'],
            '--preview-outgoing': palette.outgoing,
          } as CSSProperties;
          return (
            <button
              key={theme.id}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              className={styles.themeCard}
              style={previewStyle}
              aria-label={`${theme.label} theme`}
              aria-pressed={isSelected}
              onClick={() => {
                setPlayingTheme(theme.id);
                applyChoice({
                  themeId: previewChoice.themeId,
                  accent: null,
                  wallpaper: null,
                });
              }}
            >
              <WallpaperGradient colors={wallpaper.colors} />
              <span className={styles.previewOutgoing} />
              <span className={styles.previewIncoming} />
              <ThemeEmoji
                themeId={theme.id}
                fallback={theme.emoji}
                isPlaying={playingTheme === theme.id}
                onComplete={() =>
                  setPlayingTheme((current) => (current === theme.id ? undefined : current))
                }
              />
            </button>
          );
        })}
      </div>
      <div className={styles.variants}>
        {THEME_VARIANTS.map((mode) => (
          <SettingsRadio
            key={mode.id}
            label={mode.label}
            name="color-theme"
            value={mode.id}
            isChecked={appearance.mode === mode.id}
            onChange={() => void selectAppearanceMode(mode.id)}
          />
        ))}
      </div>
      <div
        className={styles.accentReveal}
        data-open={variant === 'dark'}
        inert={variant !== 'dark'}
      >
        <div>
          {variant === 'dark' && (
            <div
              className={styles.accentStrip}
              role="toolbar"
              aria-label="Accent colors"
              onKeyDown={movePickerFocus}
            >
              {ACCENT_COLORS.map((accent) => (
                <button
                  key={accent.color}
                  type="button"
                  className={styles.accent}
                  style={{ '--swatch-color': accent.color } as CSSProperties}
                  aria-label={`${accent.label} accent`}
                  aria-pressed={(choice.accent ?? '#0088ff') === accent.color}
                  onClick={() => applyChoice({ accent: accent.color, wallpaper: null })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
