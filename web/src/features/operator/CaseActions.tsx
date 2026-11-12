import type { components } from '@/api/schema';
import { Field, textField } from '@/features/accounts/AccountForm';
import accountStyles from '@/features/accounts/Accounts.module.css';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { OperatorActionForm } from './OperatorActionForm';
import styles from './OperatorWorkspace.module.css';

type CaseDetail = components['schemas']['CaseDetail'];
type OperatorAction = components['schemas']['OperatorAction'];

interface CaseActionsProps {
  owner: SessionOwner;
  detail: CaseDetail;
  isLocked: boolean;
  onCommitted: (action: OperatorAction) => void;
  onPasswordRequired: () => void;
}

/** Submit audited case actions and retain the typed reason if password proof expires. */
export function CaseActions(props: CaseActionsProps) {
  const { owner, detail, isLocked, onCommitted, onPasswordRequired } = props;
  const report = detail.case;
  const formProps = {
    owner,
    onCommitted,
    onPasswordRequired,
  };

  // Keep the existing forms mounted while the operator confirms their password.
  const canExtendEvidence = !report.resolved_at && (detail.evidence != null || isLocked);
  return (
    <section className={styles.caseActions} aria-label="Case actions" hidden={isLocked}>
      <h4>Case actions</h4>
      {!report.resolved_at && (
        <OperatorActionForm
          {...formProps}
          label="Resolve case"
          action={() => ({ kind: 'resolve_case', case_id: report.id })}
        />
      )}
      {canExtendEvidence && (
        <OperatorActionForm
          {...formProps}
          label="Extend evidence retention"
          action={(fields) => {
            const deadline = new Date(textField(fields, 'deadline')).toISOString();
            return { kind: 'extend_evidence', case_id: report.id, deadline };
          }}
        >
          <Field label="New evidence deadline" name="deadline" type="datetime-local" required />
        </OperatorActionForm>
      )}
      <OperatorActionForm
        {...formProps}
        label="Change reported account suspension"
        action={(fields) => {
          const isSuspended = textField(fields, 'state') === 'suspend';
          return {
            kind: 'set_suspension',
            user_id: report.reported_author_id,
            is_suspended: isSuspended,
          };
        }}
      >
        <label className={accountStyles.field}>
          Reported account action
          <select name="state">
            <option value="suspend">Suspend</option>
            <option value="restore">Restore</option>
          </select>
        </label>
      </OperatorActionForm>
      <OperatorActionForm
        {...formProps}
        label="Change conversation quarantine"
        action={(fields) => {
          const isQuarantined = textField(fields, 'state') === 'quarantine';
          return {
            kind: 'set_quarantine',
            target: { kind: 'case', case_id: report.id },
            is_quarantined: isQuarantined,
          };
        }}
      >
        <label className={accountStyles.field}>
          Conversation action
          <select name="state">
            <option value="quarantine">Quarantine</option>
            <option value="restore">Restore</option>
          </select>
        </label>
      </OperatorActionForm>
    </section>
  );
}
