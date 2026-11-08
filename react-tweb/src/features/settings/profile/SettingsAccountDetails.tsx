import { Menu } from '@ark-ui/react/menu';
import { AtSign, Copy, Mail, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { copyTextWithToast } from '@/components/copyTextWithToast';
import { Ripple } from '@/components/Ripple';
import { MenuDismissLayer } from '@/features/chat/MenuDismissLayer';
import overlays from '@/features/chat/overlays.module.css';
import styles from '../SettingsPage.module.css';

interface SettingsAccountProfile {
  email: string;
  username: string;
}

interface AccountDetailRowProps {
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
  onCopy: () => void;
}

function AccountDetailRow({ label, value, icon: Icon, color, onCopy }: AccountDetailRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <Menu.Root
      open={isMenuOpen}
      onOpenChange={({ open }) => setIsMenuOpen(open)}
      onPointerDownOutside={(event) => event.preventDefault()}
      positioning={{ placement: 'bottom-start', gutter: 0 }}
      lazyMount
      unmountOnExit
    >
      <Menu.ContextTrigger asChild>
        <button
          type="button"
          aria-label={`${value} ${label}`}
          className={`${styles.row} ${styles.accountRow}`}
          onClick={onCopy}
        >
          <span className={styles.icon} data-color={color}>
            <Icon aria-hidden="true" />
          </span>
          <span className={styles.accountText}>
            <span className={styles.accountValue} dir="ltr">
              {value}
            </span>
            <span className={styles.accountLabel}>{label}</span>
          </span>
          <Ripple />
        </button>
      </Menu.ContextTrigger>
      <MenuDismissLayer
        isOpen={isMenuOpen}
        label={`Dismiss ${label.toLowerCase()} menu`}
        onDismiss={() => setIsMenuOpen(false)}
      >
        <Menu.Positioner>
          <Menu.Content className={overlays.menu} aria-label={`${label} actions`}>
            <Menu.Item value="copy" className={overlays.menuItem} onSelect={onCopy}>
              <Copy aria-hidden="true" />
              Copy {label}
              <Ripple />
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </MenuDismissLayer>
    </Menu.Root>
  );
}

/** Display account identifiers and copy them with the same feedback as other Telegram-style rows. */
export function SettingsAccountDetails({ profile }: { profile: SettingsAccountProfile }) {
  function copyDetail({ label, text }: { label: string; text: string }) {
    void copyTextWithToast({
      text,
      successMessage: `${label} copied to clipboard`,
      errorMessage: `Could not copy ${label.toLowerCase()}`,
    });
  }

  return (
    <section className={styles.section} aria-label="Account details">
      <AccountDetailRow
        label="Email"
        value={profile.email}
        icon={Mail}
        color="green"
        onCopy={() => copyDetail({ label: 'Email', text: profile.email })}
      />
      <AccountDetailRow
        label="Username"
        value={profile.username}
        icon={AtSign}
        color="blue"
        onCopy={() => copyDetail({ label: 'Username', text: `@${profile.username}` })}
      />
    </section>
  );
}
