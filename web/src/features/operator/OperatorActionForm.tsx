import { useRef, type ReactNode } from 'react';
import type { components } from '@/api/schema';
import { AccountForm, Field, textField } from '@/features/accounts/AccountForm';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';

type OperatorAction = components['schemas']['OperatorAction'];
type OperatorCommand = components['schemas']['OperatorCommand'];

interface OperatorActionFormProps {
  owner: SessionOwner;
  label: string;
  action: (fields: FormData) => OperatorAction;
  onCommitted: (action: OperatorAction) => void;
  onPasswordRequired?: () => void;
  children?: ReactNode;
}

/** Bind a reason and stable operation identity to one reviewed operator action. */
export function OperatorActionForm(props: OperatorActionFormProps) {
  const { owner, label, action, onCommitted, onPasswordRequired, children } = props;
  const lastCommand = useRef<OperatorCommand>(undefined);

  async function submit(fields: FormData): Promise<void | false> {
    const reason = textField(fields, 'reason').trim();
    const input = action(fields);
    const previous = lastCommand.current;
    const matchesPrevious =
      previous?.reason === reason && JSON.stringify(previous.action) === JSON.stringify(input);

    // A transport error can arrive after the action and audit entry have committed.
    const command: OperatorCommand = {
      operation_id: matchesPrevious ? previous.operation_id : crypto.randomUUID(),
      reason,
      action: input,
    };
    lastCommand.current = command;
    try {
      await owner.client.POST('/api/v1/operator/commands', { body: command });
    } catch (failure) {
      const needsPassword =
        failure instanceof ApiError && failure.code === 'recent_authentication_required';
      if (onPasswordRequired && needsPassword) {
        onPasswordRequired();
        return false;
      }
      throw failure;
    }
    lastCommand.current = undefined;
    onCommitted(input);
  }

  return (
    <AccountForm submitLabel={label} onSubmit={submit} shouldReset>
      {children}
      <Field label="Reason" name="reason" required maxLength={300} />
    </AccountForm>
  );
}
