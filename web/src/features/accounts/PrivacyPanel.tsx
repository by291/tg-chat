import { useCallback } from 'react';
import type { components } from '@/api/schema';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { AccountForm, textField } from './AccountForm';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

type Privacy = components['schemas']['PrivacySettings'];
type Audience = components['schemas']['Audience'];

function readAudience(fields: FormData, name: string): Audience {
  const value = textField(fields, name);
  if (value === 'contacts' || value === 'nobody') {
    return value;
  }

  return 'everyone';
}

function AudienceField({ label, name, value }: { label: string; name: string; value: Audience }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select key={value} name={name} defaultValue={value}>
        <option value="everyone">Everyone</option>
        <option value="contacts">My contacts</option>
        <option value="nobody">Nobody</option>
      </select>
    </label>
  );
}

/** Persist visibility preferences independently for the authenticated account. */
export function PrivacyPanel({
  owner,
  settingsVersion,
}: {
  owner: SessionOwner;
  settingsVersion?: string;
}) {
  const load = useCallback(
    async () => requirePayload(await owner.client.GET('/api/v1/account/privacy')),
    [owner],
  );
  // Sync revisions refresh the fields without unmounting the form's submission feedback.
  const privacy = useAccountResource(load, settingsVersion);

  async function save(fields: FormData) {
    const settings: Privacy = {
      direct_messages: readAudience(fields, 'direct_messages'),
      calls: readAudience(fields, 'calls'),
      presence: readAudience(fields, 'presence'),
    };
    await owner.client.PATCH('/api/v1/account/privacy', { body: settings });
    privacy.reload();
  }

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <h2>Privacy</h2>
        {privacy.error && (
          <p role="alert" className={styles.error}>
            {privacy.error}
          </p>
        )}
        {privacy.isLoading && <p role="status">Loading privacy settings…</p>}
        {privacy.value && (
          <AccountForm
            submitLabel="Save privacy"
            onSubmit={save}
            successMessage="Privacy settings saved."
          >
            <AudienceField
              label="Who can start direct messages"
              name="direct_messages"
              value={privacy.value.direct_messages}
            />
            <AudienceField label="Who can call me" name="calls" value={privacy.value.calls} />
            <AudienceField
              label="Who can see my presence"
              name="presence"
              value={privacy.value.presence}
            />
            <p className={styles.hint}>
              These choices control who can start direct chats, see your online status, or call when
              calling is available. Blocks prevent direct interactions.
            </p>
          </AccountForm>
        )}
      </section>
    </div>
  );
}
