import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ApiError, isCancelled } from '../auth/SessionOwner';
import styles from './Accounts.module.css';

interface OperationOptions {
  operation: () => Promise<void | false>;
  successMessage?: string;
}

interface AccountFormProps {
  children: ReactNode;
  submitLabel: string;
  onSubmit: (fields: FormData) => Promise<void | false>;
  successMessage?: string;
  shouldReset?: boolean;
}

/** Report action failures while ignoring responses cancelled by account changes. */
export function useOperation() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run({ operation, successMessage = '' }: OperationOptions) {
    setIsPending(true);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (result !== false) {
        setNotice(successMessage);
      }
    } catch (failure) {
      if (!isCancelled(failure)) {
        const message =
          failure instanceof ApiError
            ? failure.message
            : 'The action could not be completed. Try again.';
        setError(message);
      }
    } finally {
      setIsPending(false);
    }
  }

  return {
    run,
    isPending,
    error,
    notice,
  };
}

/** Read a named text control without accepting an accidental File value. */
export function textField(fields: FormData, name: string): string {
  const value = fields.get(name);
  return typeof value === 'string' ? value : '';
}

/** Keep account form feedback, submission state, and accessible field groups consistent. */
export function AccountForm({
  children,
  submitLabel,
  onSubmit,
  successMessage,
  shouldReset = false,
}: AccountFormProps) {
  const action = useOperation();

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        void action.run({
          operation: async () => {
            // Deferred submissions keep their fields while a separate confirmation is pending.
            const result = await onSubmit(fields);
            if (result === false) {
              return false;
            }
            if (shouldReset) {
              form.reset();
            }
          },
          successMessage,
        });
      }}
    >
      <fieldset disabled={action.isPending}>
        {children}
        <button className={styles.primary} type="submit">
          {action.isPending ? 'Please wait…' : submitLabel}
        </button>
      </fieldset>
      {action.error && (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      )}
      {action.notice && (
        <p role="status" className={styles.notice}>
          {action.notice}
        </p>
      )}
    </form>
  );
}

/** Associate a visible label with a native input and preserve browser autofill semantics. */
export function Field({
  label,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();

  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <input {...input} id={id} />
    </label>
  );
}
