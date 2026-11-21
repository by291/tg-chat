import { useState, type ChangeEvent } from 'react';
import type { components } from '@/api/schema';
import { ApiError, requirePayload, type SessionOwner } from '../auth/SessionOwner';
import { AccountForm, Field, textField } from './AccountForm';
import styles from './Accounts.module.css';

const DISPLAY_NAME_LIMIT = 80;
const BIOGRAPHY_LIMIT = 500;
const PHONE_LIMIT = 40;

type Profile = components['schemas']['PrivateProfile'];

function useProfileField(saved: string) {
  const [edit, setEdit] = useState<{ original: string; value: string }>();

  // Once another revision contains this edit, the field follows future server values again.
  if (edit?.value === saved) {
    setEdit(undefined);
  }

  function change(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const value = event.target.value;
    setEdit(value === saved ? undefined : { original: edit?.original ?? saved, value });
  }

  function keepEdit() {
    if (edit) {
      setEdit({ original: saved, value: edit.value });
    }
  }

  return {
    input: { value: edit?.value ?? saved, onChange: change },
    hasConflict: Boolean(edit && edit.original !== saved && edit.value !== saved),
    saved,
    keepEdit,
    useSaved: () => setEdit(undefined),
  };
}

function ProfileConflict({
  field,
  label,
}: {
  field: ReturnType<typeof useProfileField>;
  label: string;
}) {
  if (!field.hasConflict) {
    return null;
  }

  return (
    <div role="alert">
      <p>
        {label} changed elsewhere. Saved value: {field.saved || '(empty)'}
      </p>
      <div className={styles.rowActions}>
        <button type="button" className={styles.textButton} onClick={field.useSaved}>
          Use saved {label.toLowerCase()}
        </button>
        <button type="button" className={styles.textButton} onClick={field.keepEdit}>
          Keep my {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

/** Merge untouched profile fields from the current revision and resolve overlapping edits. */
export function ProfileTextForm({ owner, profile }: { owner: SessionOwner; profile: Profile }) {
  const displayName = useProfileField(profile.display_name);
  const biography = useProfileField(profile.biography);
  const phone = useProfileField(profile.phone ?? '');
  const hasConflicts = displayName.hasConflict || biography.hasConflict || phone.hasConflict;

  async function save(fields: FormData) {
    if (hasConflicts) {
      return false;
    }

    try {
      const reply = await owner.client.PATCH('/api/v1/account/profile', {
        body: {
          version: profile.version,
          display_name: textField(fields, 'display_name'),
          biography: textField(fields, 'biography'),
          phone: textField(fields, 'phone') || null,
        },
      });
      owner.replaceProfile(requirePayload(reply));
    } catch (failure) {
      // A competing write can reach the server before its revision reaches this form.
      if (failure instanceof ApiError && failure.code === 'account_changed') {
        await owner.refresh();
      }
      throw failure;
    }

    // The server trims submitted text. Release each edit only after the write is accepted.
    displayName.useSaved();
    biography.useSaved();
    phone.useSaved();
  }

  return (
    <AccountForm
      submitLabel="Save profile"
      onSubmit={save}
      successMessage="Profile saved."
      isSubmitDisabled={hasConflicts}
    >
      <Field
        label="Display name"
        name="display_name"
        {...displayName.input}
        required
        maxLength={DISPLAY_NAME_LIMIT}
      />
      <ProfileConflict label="Display name" field={displayName} />
      <label className={styles.field}>
        <span>Biography</span>
        <textarea name="biography" {...biography.input} maxLength={BIOGRAPHY_LIMIT} />
      </label>
      <ProfileConflict label="Biography" field={biography} />
      <Field
        label="Phone (private)"
        name="phone"
        type="tel"
        {...phone.input}
        maxLength={PHONE_LIMIT}
      />
      <ProfileConflict label="Phone" field={phone} />
      <p className={styles.hint}>
        Your phone is private account text. It is not used for login or directory search.
      </p>
    </AccountForm>
  );
}
