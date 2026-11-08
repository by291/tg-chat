import { Switch } from '@ark-ui/react/switch';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import styles from './SettingsPage.module.css';

const PERCENTAGE_SCALE = 100;

interface SettingsRangeProps {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  unit?: string;
}

interface SettingsRadioProps {
  label: string;
  description?: string;
  name: string;
  value: string;
  isChecked: boolean;
  onChange: () => void;
}

interface SettingsHeaderProps {
  title: string;
  backLabel: string;
  onBack: () => void;
  children?: ReactNode;
}

interface SettingsRowProps {
  label: string;
  icon: LucideIcon;
  color: string;
  onClick: () => void;
  value?: string;
}

interface SettingsSwitchProps {
  label: string;
  icon?: LucideIcon;
  color?: string;
  isChecked: boolean;
  isDisabled?: boolean;
  onChange: (options: { isChecked: boolean }) => void;
}

/** Keep settings titles and back controls aligned across sidebar pages. */
export function SettingsHeader({ title, backLabel, onBack, children }: SettingsHeaderProps) {
  return (
    <header className={styles.header}>
      <IconButton label={backLabel} onClick={onBack}>
        <ArrowLeft />
      </IconButton>
      <h2>{title}</h2>
      {children}
    </header>
  );
}

/** Open a settings category using the same hit area as a preference row. */
export function SettingsRow({ label, icon: Icon, color, onClick, value }: SettingsRowProps) {
  return (
    <button type="button" className={styles.row} data-settings-label={label} onClick={onClick}>
      <span className={styles.icon} data-color={color}>
        <Icon aria-hidden="true" />
      </span>
      <span className={styles.label}>{label}</span>
      {value && <span className={styles.value}>{value}</span>}
      <Ripple />
    </button>
  );
}

/** Apply an accessible preference immediately from anywhere on its row. */
export function SettingsSwitch({
  label,
  icon: Icon,
  color,
  isChecked,
  isDisabled = false,
  onChange,
}: SettingsSwitchProps) {
  return (
    <Switch.Root
      className={styles.row}
      data-settings-label={label}
      data-has-icon={Boolean(Icon)}
      checked={isChecked}
      disabled={isDisabled}
      onCheckedChange={({ checked }) => onChange({ isChecked: checked })}
    >
      {Icon && (
        <span className={styles.icon} data-color={color}>
          <Icon aria-hidden="true" />
        </span>
      )}
      <Switch.Label className={styles.label}>{label}</Switch.Label>
      <Switch.Control className={styles.switchControl}>
        <Switch.Thumb className={styles.switchThumb} />
      </Switch.Control>
      <Switch.HiddenInput />
      <Ripple />
    </Switch.Root>
  );
}

/** Render a precise slider while the native input owns dragging and keyboard increments. */
export function SettingsRange({
  label,
  value,
  minimum,
  maximum,
  onChange,
  onChangeEnd,
  unit = '',
}: SettingsRangeProps) {
  const progress = ((value - minimum) / (maximum - minimum)) * PERCENTAGE_SCALE;
  const rangeStyle = { '--range-progress': `${progress}%` } as CSSProperties;

  return (
    <label className={styles.range} data-settings-label={label}>
      <span className={styles.rangeDetails}>
        <span>{label}</span>
        <output>
          {value}
          {unit}
        </output>
      </span>
      <span className={styles.rangeTrack} style={rangeStyle}>
        <input
          className={styles.rangeInput}
          type="range"
          aria-label={label}
          min={minimum}
          max={maximum}
          step={1}
          value={value}
          onChange={(event) => onChange(event.target.valueAsNumber)}
          onPointerUp={(event) => onChangeEnd?.(event.currentTarget.valueAsNumber)}
          onKeyUp={(event) => {
            const isRangeKey =
              event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End';
            if (isRangeKey) {
              onChangeEnd?.(event.currentTarget.valueAsNumber);
            }
          }}
        />
        <span className={styles.rangeFilled} aria-hidden="true" />
      </span>
    </label>
  );
}

/** Keep the whole option clickable while animating the selected radio independently. */
export function SettingsRadio({
  label,
  description,
  name,
  value,
  isChecked,
  onChange,
}: SettingsRadioProps) {
  const descriptionId = useId();
  return (
    <label className={styles.radioRow}>
      <input
        className={styles.radioInput}
        type="radio"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        name={name}
        value={value}
        checked={isChecked}
        onChange={onChange}
      />
      <span className={styles.radioControl} aria-hidden="true" />
      <span className={styles.radioText}>
        <span>{label}</span>
        {description && (
          <span id={descriptionId} className={styles.radioDescription}>
            {description}
          </span>
        )}
      </span>
      <Ripple />
    </label>
  );
}
