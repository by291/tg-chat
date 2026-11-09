import { useState } from 'react';
import type { components } from '@/api/schema';
import { AccountForm, Field, textField } from '@/features/accounts/AccountForm';
import styles from '@/features/accounts/Accounts.module.css';

type Settings = components['schemas']['CommunitySettings'];

/** Read explicit community settings from the accessible native form controls. */
export function readCommunitySettings(fields: FormData): Settings {
  return {
    title: textField(fields, 'title'),
    description: textField(fields, 'description'),
    public_handle: textField(fields, 'public_handle') || null,
    is_public: fields.has('is_public'),
    requires_approval: fields.has('requires_approval'),
  };
}

/** Share metadata controls while keeping create and expected-version saves independently owned. */
export function CommunitySettingsForm(props: {
  initial?: Settings;
  isCreating?: boolean;
  onSubmit: (fields: FormData) => Promise<void>;
}) {
  const [isPublic, setIsPublic] = useState(props.initial?.is_public ?? false);
  return (
    <AccountForm
      submitLabel={props.isCreating ? 'Create community' : 'Save community settings'}
      onSubmit={props.onSubmit}
    >
      {props.isCreating && (
        <label className={styles.field}>
          <span>Community type</span>
          <select name="kind" defaultValue="group">
            <option value="group">Group</option>
            <option value="channel">Channel</option>
          </select>
        </label>
      )}
      <Field
        label="Community title"
        name="title"
        required
        maxLength={128}
        defaultValue={props.initial?.title}
      />
      <label className={styles.field}>
        <span>Description</span>
        <textarea name="description" maxLength={2000} defaultValue={props.initial?.description} />
      </label>
      <label>
        <input
          type="checkbox"
          name="is_public"
          checked={isPublic}
          onChange={(event) => setIsPublic(event.target.checked)}
        />
        Public discovery
      </label>
      <Field
        label="Public handle"
        name="public_handle"
        required={isPublic}
        minLength={3}
        maxLength={32}
        pattern="[A-Za-z0-9_]+"
        defaultValue={props.initial?.public_handle ?? ''}
      />
      <label>
        <input
          type="checkbox"
          name="requires_approval"
          defaultChecked={props.initial?.requires_approval}
        />
        Approve public and invite-link join requests
      </label>
      <p className={styles.hint}>
        Admitted members can read retained history. Private communities are absent from discovery.
      </p>
    </AccountForm>
  );
}
