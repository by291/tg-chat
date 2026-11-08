import { ImagePlus, Palette, RotateCcw } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { getAppearance, type ThemeChoice } from './appearanceStore';
import { selectThemeChoice } from './appearanceActions';
import { WallpaperGradient } from './WallpaperGradient';
import { getThemePalette, getWallpaperAppearance, THEME_CARDS } from './themeCatalog';
import { useResolvedAppearance } from './useAppearanceTheme';
import { discardWallpaperImage, saveWallpaperImage } from './wallpaperImages';
import { showToast } from '@/components/toastStore';
import { SettingsHeader, SettingsRow, SettingsSwitch } from '../SettingsControls';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import { WallpaperColorPicker } from './WallpaperColorPicker';
import settings from '../SettingsPage.module.css';
import styles from './WallpaperSettingsPage.module.css';

const WALLPAPER_COLORS = [
  '#e6ebee',
  '#b2cee1',
  '#008dd0',
  '#c6e7cb',
  '#c4e1a6',
  '#60b16e',
  '#ccd0af',
  '#a6a997',
  '#7a7072',
  '#fdd7af',
  '#fdb76e',
  '#dd8851',
];

/** Change the current mode's background without replacing its bubble or accent colors. */
export function WallpaperSettingsPage({ onBack }: { onBack: () => void }) {
  const { variant, choice } = useResolvedAppearance();
  const [isColorOpen, setIsColorOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wallpaper = choice.wallpaper;

  function applyWallpaper(next: ThemeChoice['wallpaper']) {
    return selectThemeChoice({ variant, changes: { wallpaper: next } });
  }

  async function uploadWallpaper(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setIsUploading(true);
    try {
      const imageId = await saveWallpaperImage(file);
      // The user may have selected another background while the image was decoding.
      if (getAppearance().choices[variant] !== choice) {
        await discardWallpaperImage(imageId);
        return;
      }
      await applyWallpaper({
        kind: 'image',
        imageId,
        isBlurred: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save this wallpaper.';
      showToast(message);
    } finally {
      setIsUploading(false);
    }
  }

  const overview = (
    <section className={settings.page} aria-label="Chat Wallpaper">
      <SettingsHeader title="Chat Wallpaper" backLabel="Back from wallpaper" onBack={onBack} />
      <div className={settings.scrollContent}>
        <div className={settings.section}>
          <SettingsRow
            label={isUploading ? 'Preparing Wallpaper…' : 'Upload Wallpaper'}
            icon={ImagePlus}
            color="blue"
            onClick={() => {
              if (!isUploading) {
                inputRef.current?.click();
              }
            }}
          />
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Upload wallpaper image"
            className={styles.fileInput}
            onChange={(event) => void uploadWallpaper(event)}
          />
          <SettingsRow
            label="Set a color"
            icon={Palette}
            color="purple"
            onClick={() => setIsColorOpen(true)}
          />
          <SettingsRow
            label="Reset to Defaults"
            icon={RotateCcw}
            color="gray"
            onClick={() => applyWallpaper(null)}
          />
          {wallpaper?.kind === 'image' && (
            <SettingsSwitch
              label="Blur Wallpaper Image"
              isChecked={wallpaper.isBlurred}
              onChange={({ isChecked }) => applyWallpaper({ ...wallpaper, isBlurred: isChecked })}
            />
          )}
        </div>
        <div className={styles.grid} aria-label="Wallpapers">
          {THEME_CARDS.map((theme) => {
            const previewChoice = {
              ...choice,
              themeId: theme.id,
              accent: null,
              wallpaper: null,
            } as ThemeChoice;
            const preview = getWallpaperAppearance({ variant, choice: previewChoice });
            const isSelected = wallpaper?.kind === 'gradient' && wallpaper.themeId === theme.id;
            const isDefault = !wallpaper && choice.themeId === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                className={styles.wallpaperTile}
                style={{ background: preview.background }}
                aria-label={`${theme.label} wallpaper`}
                aria-pressed={isSelected || isDefault}
                onClick={() => applyWallpaper({ kind: 'gradient', themeId: previewChoice.themeId })}
              >
                <WallpaperGradient colors={preview.colors} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );

  return (
    <div
      className={settings.page}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isColorOpen && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setIsColorOpen(false);
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={isColorOpen}
        primary={overview}
        secondary={<WallpaperColorPage onBack={() => setIsColorOpen(false)} />}
      />
    </div>
  );
}

function WallpaperColorPage({ onBack }: { onBack: () => void }) {
  const { variant, choice } = useResolvedAppearance();
  const palette = getThemePalette({ variant, choice });
  const color = choice.wallpaper?.kind === 'color' ? choice.wallpaper.color : palette.wallpaper[0];

  function setColor(next: string) {
    if (!/^#[\da-f]{6}$/i.test(next)) {
      return;
    }
    void selectThemeChoice({ variant, changes: { wallpaper: { kind: 'color', color: next } } });
  }

  return (
    <section className={settings.page} aria-label="Wallpaper color">
      <SettingsHeader title="Set a color" backLabel="Back from wallpaper color" onBack={onBack} />
      <div className={settings.scrollContent}>
        <div className={`${settings.section} ${styles.colorSection}`}>
          <WallpaperColorPicker color={color} onChange={setColor} />
        </div>
        <div className={styles.grid}>
          {WALLPAPER_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={styles.colorTile}
              style={{ background: swatch }}
              aria-label={`Use ${swatch}`}
              aria-pressed={choice.wallpaper?.kind === 'color' && color.toLowerCase() === swatch}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
