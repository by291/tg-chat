import { Menu } from '@ark-ui/react/menu';
import { Fragment, useState, type ReactNode } from 'react';
import { isAppleKeyboard } from '../../app/keyboard/keyboardPlatform';
import { setAppPreferences, useAppPreferences } from '../../app/settings/appPreferences';
import { Ripple } from '../../components/Ripple';
import { MenuDismissLayer } from '../MenuDismissLayer';
import { SettingsHeader } from './SettingsControls';
import settings from './SettingsPage.module.css';
import styles from './KeyboardSettingsPage.module.css';
import overlays from '../overlays.module.css';

const SHORTCUT_ROW_HEIGHT = 54;
const SEND_OPTION_HEIGHT = 40;
const SEND_MENU_PADDING = 4;

const KEY_LABELS: Record<string, { apple: string; other: string; accessible?: string }> = {
  modifier: { apple: '⌘', other: 'Ctrl' },
  shift: { apple: '⇧', other: 'Shift' },
  alt: { apple: '⌥', other: 'Alt' },
  enter: { apple: '↵', other: 'Enter' },
  up: { apple: '↑', other: '↑', accessible: 'Up arrow' },
  down: { apple: '↓', other: '↓', accessible: 'Down arrow' },
  left: { apple: '←', other: '←', accessible: 'Left arrow' },
  right: { apple: '→', other: '→', accessible: 'Right arrow' },
};

const FORMATTING_SHORTCUTS = [
  { label: 'Bold', key: 'B' },
  { label: 'Italic', key: 'I' },
  { label: 'Underline', key: 'U' },
  { label: 'Strikethrough', key: 'S' },
  { label: 'Monospace', key: 'M' },
  { label: 'Spoiler', key: 'P' },
  { label: 'Add Link', key: 'K' },
];

function KeyCombo({ keys }: { keys: string[] }) {
  const isApple = isAppleKeyboard();
  const labels = keys.map((key) => {
    const labels = KEY_LABELS[key];
    return labels ? (isApple ? labels.apple : labels.other) : key;
  });
  const accessibleKeys = keys.map((key) => {
    if (key === 'modifier') {
      return isApple ? 'Command' : 'Control';
    }
    return KEY_LABELS[key]?.accessible ?? KEY_LABELS[key]?.other ?? key;
  });
  return (
    <span className={styles.keys} aria-label={accessibleKeys.join(' + ')}>
      {labels.map((label, index) => (
        <Fragment key={`${label}-${index}`}>
          {index > 0 && (
            <span className={styles.plus} aria-hidden="true">
              +
            </span>
          )}
          <kbd aria-hidden="true">{label}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

function ShortcutRow({
  label,
  keys,
  hint,
  isUnavailable = false,
}: {
  label: string;
  keys: string[];
  hint?: string;
  isUnavailable?: boolean;
}) {
  return (
    <div className={styles.row} data-unavailable={isUnavailable || undefined}>
      <span className={styles.description}>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
        {isUnavailable && <small>Not available yet</small>}
      </span>
      <KeyCombo keys={keys} />
    </div>
  );
}

function ShortcutSection({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <>
      <section className={settings.section} aria-label={title}>
        <h3>{title}</h3>
        {children}
      </section>
      {caption && <p className={settings.caption}>{caption}</p>}
    </>
  );
}

function SendShortcutRow() {
  const sendShortcut = useAppPreferences((preferences) => preferences.sendShortcut);
  const [isOpen, setIsOpen] = useState(false);
  const isModifierSend = sendShortcut === 'ctrlEnter';
  const sendKeys = isModifierSend ? ['modifier', 'enter'] : ['enter'];
  const selectedOptionOffset = isModifierSend ? SEND_OPTION_HEIGHT : 0;
  // Align the selected option with the row's current value, as Telegram's inline selector does.
  const menuOffset = -(
    SHORTCUT_ROW_HEIGHT / 2 +
    SEND_MENU_PADDING +
    SEND_OPTION_HEIGHT / 2 +
    selectedOptionOffset
  );
  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={({ open }) => setIsOpen(open)}
      onPointerDownOutside={(event) => event.preventDefault()}
      positioning={{ placement: 'bottom-end', gutter: menuOffset }}
      lazyMount
      unmountOnExit
    >
      <Menu.Trigger asChild>
        <button
          className={`${styles.row} ${styles.sendRow}`}
          aria-label="Send message shortcut"
          data-settings-label="Send message"
        >
          <span>Send message</span>
          <KeyCombo keys={sendKeys} />
          <Ripple />
        </button>
      </Menu.Trigger>
      <MenuDismissLayer
        isOpen={isOpen}
        label="Dismiss send shortcut menu"
        onDismiss={() => setIsOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content
            className={`${overlays.menu} ${styles.sendMenu}`}
            aria-label="Send message with"
            data-selection={sendShortcut}
          >
            <Menu.Item
              value="enter"
              className={overlays.menuItem}
              data-selected={sendShortcut === 'enter'}
              onSelect={() => setAppPreferences({ sendShortcut: 'enter' })}
            >
              <KeyCombo keys={['enter']} />
            </Menu.Item>
            <Menu.Item
              value="ctrlEnter"
              className={overlays.menuItem}
              data-selected={sendShortcut === 'ctrlEnter'}
              onSelect={() => setAppPreferences({ sendShortcut: 'ctrlEnter' })}
            >
              <KeyCombo keys={['modifier', 'enter']} />
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </MenuDismissLayer>
    </Menu.Root>
  );
}

/** Document actual shortcut support with Telegram-style groups, keycaps, and send preferences. */
export function KeyboardSettingsPage({ onBack }: { onBack: () => void }) {
  const sendShortcut = useAppPreferences((preferences) => preferences.sendShortcut);
  const newLineKeys = sendShortcut === 'ctrlEnter' ? ['enter'] : ['shift', 'enter'];
  const modifierKeys = ['modifier'];
  const monospaceModifiers = isAppleKeyboard() ? ['modifier', 'shift'] : modifierKeys;
  return (
    <section className={settings.page} aria-label="Keyboard Shortcuts">
      <SettingsHeader
        title="Keyboard Shortcuts"
        backLabel="Back from keyboard shortcuts"
        onBack={onBack}
      />
      <div className={settings.scrollContent}>
        <ShortcutSection
          title="Text Formatting"
          caption="Select text in the chat input to apply formatting."
        >
          {FORMATTING_SHORTCUTS.map(({ label, key }) => (
            <ShortcutRow
              key={key}
              label={label}
              keys={[...(key === 'M' ? monospaceModifiers : modifierKeys), key]}
            />
          ))}
        </ShortcutSection>
        <ShortcutSection
          title="Messages"
          caption="Choose how messages are sent and how new lines are inserted."
        >
          <SendShortcutRow />
          <ShortcutRow label="New line" keys={newLineKeys} />
          <ShortcutRow label="Jump to start of input" keys={['modifier', 'PageUp']} isUnavailable />
          <ShortcutRow label="Jump to end of input" keys={['modifier', 'PageDown']} isUnavailable />
        </ShortcutSection>
        <ShortcutSection title="Chat">
          <ShortcutRow
            label="Edit last message"
            hint="When the message field is empty"
            keys={['up']}
            isUnavailable
          />
          <ShortcutRow label="Reply to previous message" keys={['modifier', 'up']} isUnavailable />
          <ShortcutRow label="Next chat" keys={['alt', 'down']} isUnavailable />
          <ShortcutRow label="Previous chat" keys={['alt', 'up']} isUnavailable />
        </ShortcutSection>
        <ShortcutSection title="Navigation">
          <ShortcutRow label="Open search" keys={['modifier', 'F']} isUnavailable />
          <ShortcutRow label="Open Saved Messages" keys={['modifier', '0']} isUnavailable />
          <ShortcutRow label="Close popup or menu" keys={['Esc']} />
        </ShortcutSection>
        <ShortcutSection title="Media Viewer">
          <ShortcutRow label="Next media" keys={['right']} />
          <ShortcutRow label="Previous media" keys={['left']} />
          <ShortcutRow label="Zoom in" keys={['modifier', '+']} />
          <ShortcutRow label="Zoom out" keys={['modifier', '−']} />
        </ShortcutSection>
        <ShortcutSection title="Stories" caption="Stories are not available in this app yet.">
          <ShortcutRow label="Next story" keys={['right']} isUnavailable />
          <ShortcutRow label="Previous story" keys={['left']} isUnavailable />
          <ShortcutRow label="Play / pause story" keys={['Space']} isUnavailable />
          <ShortcutRow label="Close stories" keys={['down']} isUnavailable />
        </ShortcutSection>
        <ShortcutSection
          title="Media Editor"
          caption="Media editing is not available in this app yet."
        >
          <ShortcutRow label="Undo" keys={['modifier', 'Z']} isUnavailable />
          <ShortcutRow label="Redo" keys={[...modifierKeys, 'shift', 'Z']} isUnavailable />
        </ShortcutSection>
        <ShortcutSection title="Other">
          <ShortcutRow label="Lock by passcode" keys={['—']} isUnavailable />
        </ShortcutSection>
      </div>
    </section>
  );
}
