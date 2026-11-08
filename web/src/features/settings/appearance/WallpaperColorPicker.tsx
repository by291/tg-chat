import { ColorPicker, parseColor } from '@ark-ui/react/color-picker';
import { useMemo, useState } from 'react';
import styles from './WallpaperColorPicker.module.css';

// prettier-ignore
const HEX_CHANNEL_OFFSETS = [
  1,
  3,
  5,
];

interface WallpaperColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

/** Edit an opaque wallpaper color through a saturation area, hue slider, and exact color fields. */
export function WallpaperColorPicker({ color, onChange }: WallpaperColorPickerProps) {
  const value = useMemo(() => parseColor(color), [color]);
  const [rgbDraft, setRgbDraft] = useState<string>();
  const rgb = HEX_CHANNEL_OFFSETS.map((offset) =>
    parseInt(color.slice(offset, offset + 2), 16),
  ).join(', ');

  function applyRgb(text: string) {
    const channels = text.split(',').map((channel) => channel.trim());
    const isValid =
      channels.length === 3 &&
      channels.every((channel) => {
        return /^\d{1,3}$/.test(channel) && Number(channel) <= 255;
      });
    if (!isValid) {
      return;
    }

    onChange(parseColor(`rgb(${text})`).toString('hex'));
  }

  return (
    <ColorPicker.Root
      inline
      value={value}
      format="hsba"
      className={styles.picker}
      onValueChange={({ value: next }) => onChange(next.toString('hex'))}
    >
      <ColorPicker.Area className={styles.area}>
        <ColorPicker.AreaBackground className={styles.areaBackground} />
        <ColorPicker.AreaThumb className={styles.thumb} />
      </ColorPicker.Area>
      <ColorPicker.ChannelSlider channel="hue" className={styles.hue}>
        <ColorPicker.ChannelSliderTrack className={styles.hueTrack} />
        <ColorPicker.ChannelSliderThumb className={styles.thumb} />
      </ColorPicker.ChannelSlider>
      <div className={styles.fields}>
        <label>
          <span>HEX</span>
          <ColorPicker.ChannelInput channel="hex" aria-label="Hex color" />
        </label>
        <label>
          <span>RGB</span>
          <input
            aria-label="RGB color"
            value={rgbDraft ?? rgb}
            onChange={(event) => {
              setRgbDraft(event.target.value);
              applyRgb(event.target.value);
            }}
            onBlur={() => setRgbDraft(undefined)}
          />
        </label>
      </div>
    </ColorPicker.Root>
  );
}
