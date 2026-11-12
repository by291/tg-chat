import { Ban, Clock, LockKeyhole, MessageCircle, Phone } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { components } from '@/api/schema';
import { SettingsHeader, SettingsRadio, SettingsRow } from '@/features/settings/SettingsControls';
import { ApiError, SessionOwner, requirePayload } from '../auth/SessionOwner';
import { AccountForm, textField } from './AccountForm';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

type Privacy = components['schemas']['PrivacySettings'];
type Audience = components['schemas']['Audience'];
type PrivacySetting = keyof Privacy;

const AUDIENCE_OPTIONS = ['everyone', 'contacts', 'nobody'] as const;

const AUDIENCES: Record<Audience, string> = {
  everyone: 'Everyone',
  contacts: 'My contacts',
  nobody: 'Nobody',
};

const PRIVACY_SETTINGS = [
  {
    key: 'direct_messages',
    label: 'Messages',
    question: 'Who can start direct messages?',
    icon: MessageCircle,
  },
  {
    key: 'calls',
    label: 'Calls',
    question: 'Who can call me?',
    icon: Phone,
  },
  {
    key: 'presence',
    label: 'Last seen & online',
    question: 'Who can see my online status?',
    icon: Clock,
  },
] as const;

interface PrivacyPanelProps {
  owner: SessionOwner;
  settingsVersion?: string;
  onBack?: () => void;
  onOpenBlocked?: () => void;
  onOpenSecurity?: () => void;
}

function readAudience(fields: FormData): Audience {
  const value = textField(fields, 'audience');
  if (value === 'everyone' || value === 'contacts' || value === 'nobody') {
    return value;
  }

  throw new ApiError({ code: 'validation_error', message: 'Choose a privacy audience.' });
}

function PrivacyAudience({
  setting,
  audience,
  onSave,
}: {
  setting: (typeof PRIVACY_SETTINGS)[number];
  audience: Audience;
  onSave: (audience: Audience) => Promise<void>;
}) {
  const [choice, setChoice] = useState(audience);

  return (
    <AccountForm
      submitLabel="Save"
      onSubmit={(fields) => onSave(readAudience(fields))}
      successMessage="Privacy settings saved."
    >
      <h3>{setting.question}</h3>
      {AUDIENCE_OPTIONS.map((value) => (
        <SettingsRadio
          key={value}
          label={AUDIENCES[value]}
          name="audience"
          value={value}
          isChecked={choice === value}
          onChange={() => setChoice(value)}
        />
      ))}
    </AccountForm>
  );
}

/** Open privacy audiences separately and save the selected setting through the account API. */
export function PrivacyPanel({
  owner,
  settingsVersion,
  onBack,
  onOpenBlocked,
  onOpenSecurity,
}: PrivacyPanelProps) {
  const [selection, setSelection] = useState<PrivacySetting>();
  const load = useCallback(
    async () => requirePayload(await owner.client.GET('/api/v1/account/privacy')),
    [owner],
  );
  const privacy = useAccountResource(load, settingsVersion);
  const savedPolicy = privacy.value;
  const setting = PRIVACY_SETTINGS.find((candidate) => candidate.key === selection);

  async function save(key: PrivacySetting, audience: Audience) {
    // The account API accepts the whole policy. Refresh the other values before replacing it.
    const latest = await load();
    await owner.client.PATCH('/api/v1/account/privacy', { body: { ...latest, [key]: audience } });
    privacy.reload();
  }

  return (
    <>
      {setting && (
        <SettingsHeader
          title={setting.label}
          backLabel="Back to privacy and security"
          onBack={() => setSelection(undefined)}
        />
      )}
      {!setting && onBack && (
        <SettingsHeader title="Privacy and Security" backLabel="Back to settings" onBack={onBack} />
      )}
      <div className={styles.panel}>
        {privacy.error && (
          <p role="alert" className={styles.error}>
            {privacy.error}
          </p>
        )}
        {privacy.isLoading && <p role="status">Loading privacy settings…</p>}
        {setting && savedPolicy && (
          <PrivacyAudience
            key={setting.key}
            setting={setting}
            audience={savedPolicy[setting.key]}
            onSave={(audience) => save(setting.key, audience)}
          />
        )}
        {!setting && (
          <>
            <section className={styles.settingsGroup} aria-label="Privacy">
              {savedPolicy &&
                PRIVACY_SETTINGS.map(({ key, label, icon }) => (
                  <SettingsRow
                    key={key}
                    label={label}
                    icon={icon}
                    color="blue"
                    value={AUDIENCES[savedPolicy[key]]}
                    onClick={() => setSelection(key)}
                  />
                ))}
              {onOpenBlocked && (
                <SettingsRow label="Blocked users" icon={Ban} color="red" onClick={onOpenBlocked} />
              )}
            </section>
            {onOpenSecurity && (
              <section className={styles.settingsGroup} aria-label="Security">
                <SettingsRow
                  label="Password & recovery"
                  icon={LockKeyhole}
                  color="purple"
                  onClick={onOpenSecurity}
                />
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
