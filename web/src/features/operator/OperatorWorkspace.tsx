import { useState } from 'react';
import type { components } from '@/api/schema';
import { AccountForm, Field, textField, useOperation } from '@/features/accounts/AccountForm';
import { PasswordConfirmation } from '@/features/accounts/SecurityPanel';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import styles from '@/features/accounts/Accounts.module.css';
import { OperatorActionForm } from './OperatorActionForm';

type CasePage = components['schemas']['CasePage'];
type CaseDetail = components['schemas']['CaseDetail'];
type Community = components['schemas']['OperatorCommunity'];
type Account = components['schemas']['OperatorAccount'];
type Storage = components['schemas']['StorageUsage'];
type Job = components['schemas']['OperatorJob'];
type JobKind = components['schemas']['OperatorJobKind'];

type OperatorPage = 'cases' | 'accounts' | 'communities' | 'jobs' | 'registration';

const PAGES: Record<OperatorPage, string> = {
  cases: 'Reports',
  accounts: 'Accounts',
  communities: 'Communities',
  jobs: 'Failed jobs',
  registration: 'Registration',
};

function ReportCases({ owner }: { owner: SessionOwner }) {
  const operation = useOperation();
  const [page, setPage] = useState<CasePage>();
  const [detail, setDetail] = useState<CaseDetail>();
  const [openedId, setOpenedId] = useState<string>();

  function loadCases(after?: string) {
    void operation.run({
      operation: async () => {
        const response = await owner.client.GET('/api/v1/operator/cases', {
          params: { query: { after } },
        });
        setPage(requirePayload(response));
      },
    });
  }

  function openCase(caseId: string) {
    setOpenedId(caseId);
    setDetail(undefined);
    void operation.run({
      operation: async () => {
        const response = await owner.client.GET('/api/v1/operator/cases/{case_id}', {
          params: { path: { case_id: caseId } },
        });
        setDetail(requirePayload(response));
      },
    });
  }

  const report = detail?.case;
  return (
    <>
      <button type="button" disabled={operation.isPending} onClick={() => loadCases()}>
        Load reports
      </button>
      {operation.error && <p role="alert">{operation.error}</p>}
      {page?.items.length === 0 && <p>No reports.</p>}
      <ul>
        {page?.items.map((item) => (
          <li key={item.id}>
            <button type="button" disabled={operation.isPending} onClick={() => openCase(item.id)}>
              Review {item.reason.replaceAll('_', ' ')} report
            </button>
            <span> {item.resolved_at ? 'Resolved' : 'Open'}</span>
          </li>
        ))}
      </ul>
      {page?.next && (
        <button type="button" disabled={operation.isPending} onClick={() => loadCases(page.next!)}>
          Older reports
        </button>
      )}
      {detail && report && report.id === openedId && (
        <section className={styles.card} aria-label="Case evidence">
          <h3>Case evidence</h3>
          {detail.evidence ? (
            <>
              <p>{detail.evidence.message_text}</p>
              {detail.evidence.structured_body != null && (
                <pre>{JSON.stringify(detail.evidence.structured_body, null, 2)}</pre>
              )}
              {detail.evidence.reporter_note && <p>Report note: {detail.evidence.reporter_note}</p>}
              <ul>
                {detail.attachments.map((file) => (
                  <li key={file.occurrence_id}>
                    <a href={caseDownload(report.id, file.occurrence_id)} download={file.file_name}>
                      Download {file.file_name}
                    </a>
                  </li>
                ))}
              </ul>
              <p>Evidence expires {new Date(report.evidence_expires_at).toLocaleString()}.</p>
            </>
          ) : (
            <p>Evidence has expired.</p>
          )}
          {!report.resolved_at && (
            <OperatorActionForm
              owner={owner}
              label="Resolve case"
              action={() => ({ kind: 'resolve_case', case_id: report.id })}
              onCommitted={() => openCase(report.id)}
            />
          )}
          {!report.resolved_at && detail.evidence && (
            <OperatorActionForm
              owner={owner}
              label="Extend evidence retention"
              action={(fields) => {
                const deadline = new Date(textField(fields, 'deadline')).toISOString();
                return { kind: 'extend_evidence', case_id: report.id, deadline };
              }}
              onCommitted={() => openCase(report.id)}
            >
              <Field label="New evidence deadline" name="deadline" type="datetime-local" required />
            </OperatorActionForm>
          )}
          <OperatorActionForm
            owner={owner}
            label="Change reported account suspension"
            action={(fields) => {
              const isSuspended = textField(fields, 'state') === 'suspend';
              return {
                kind: 'set_suspension',
                user_id: report.reported_author_id,
                is_suspended: isSuspended,
              };
            }}
            onCommitted={() => openCase(report.id)}
          >
            <label className={styles.field}>
              Reported account action
              <select name="state">
                <option value="suspend">Suspend</option>
                <option value="restore">Restore</option>
              </select>
            </label>
          </OperatorActionForm>
          <OperatorActionForm
            owner={owner}
            label="Change conversation quarantine"
            action={(fields) => {
              const isQuarantined = textField(fields, 'state') === 'quarantine';
              return {
                kind: 'set_quarantine',
                target: { kind: 'case', case_id: report.id },
                is_quarantined: isQuarantined,
              };
            }}
            onCommitted={() => openCase(report.id)}
          >
            <label className={styles.field}>
              Conversation action
              <select name="state">
                <option value="quarantine">Quarantine</option>
                <option value="restore">Restore</option>
              </select>
            </label>
          </OperatorActionForm>
        </section>
      )}
    </>
  );
}

function caseDownload(caseId: string, occurrenceId: string): string {
  const casePath = encodeURIComponent(caseId);
  const attachmentPath = encodeURIComponent(occurrenceId);
  return `/api/v1/operator/cases/${casePath}/attachments/${attachmentPath}`;
}

function AccountOperations({ owner }: { owner: SessionOwner }) {
  const [results, setResults] = useState<Account[]>();
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState<Account>();
  const [usage, setUsage] = useState<Storage>();
  const operation = useOperation();

  async function loadAccounts(query: string, after?: string) {
    const response = await owner.client.GET('/api/v1/operator/accounts', {
      params: { query: { search: query, after } },
    });
    setResults(requirePayload(response));
    setSearch(query);
  }

  function loadUsage(person: Account) {
    setAccount(person);
    setUsage(undefined);
    void operation.run({
      operation: async () => {
        const response = await owner.client.GET('/api/v1/operator/storage/{user_id}', {
          params: { path: { user_id: person.id } },
        });
        setUsage(requirePayload(response));
      },
    });
  }

  return (
    <>
      <AccountForm
        submitLabel="Find accounts"
        onSubmit={(fields) => loadAccounts(textField(fields, 'search'))}
      >
        <Field label="Username or display name" name="search" maxLength={200} />
      </AccountForm>
      {operation.error && <p role="alert">{operation.error}</p>}
      <ul>
        {results?.map((person) => (
          <li key={person.id}>
            <button type="button" disabled={operation.isPending} onClick={() => loadUsage(person)}>
              {person.display_name} (@{person.username})
            </button>
            <span> {person.is_suspended ? 'Suspended' : 'Active'}</span>
          </li>
        ))}
      </ul>
      {results?.length === 50 && (
        <button
          type="button"
          onClick={() =>
            void operation.run({ operation: () => loadAccounts(search, results.at(-1)?.id) })
          }
        >
          More accounts
        </button>
      )}
      {account && (
        <section className={styles.card}>
          <h3>@{account.username}</h3>
          <OperatorActionForm
            owner={owner}
            label={account.is_suspended ? 'Restore account' : 'Suspend account'}
            action={() => ({
              kind: 'set_suspension',
              user_id: account.id,
              is_suspended: !account.is_suspended,
            })}
            onCommitted={() => loadUsage({ ...account, is_suspended: !account.is_suspended })}
          />
          {usage && (
            <>
              <p>
                Account storage {usage.account_bytes} / {usage.account_limit_bytes} bytes.
              </p>
              <p>
                Deployment originals {usage.original_bytes} / {usage.original_limit_bytes} bytes.
              </p>
              <OperatorActionForm
                owner={owner}
                label="Set account storage limit"
                action={(fields) => ({
                  kind: 'set_account_storage_limit',
                  user_id: account.id,
                  limit_bytes: textField(fields, 'bytes').trim() || null,
                })}
                onCommitted={() => loadUsage(account)}
              >
                <Field
                  label="Limit in bytes (blank to restore default)"
                  name="bytes"
                  inputMode="numeric"
                />
              </OperatorActionForm>
            </>
          )}
        </section>
      )}
    </>
  );
}

function CommunityOperations({ owner }: { owner: SessionOwner }) {
  const [results, setResults] = useState<Community[]>();
  const [search, setSearch] = useState('');
  const [community, setCommunity] = useState<Community>();
  const operation = useOperation();

  async function loadCommunities(query: string, after?: string) {
    const response = await owner.client.GET('/api/v1/operator/communities', {
      params: { query: { search: query, after } },
    });
    setResults(requirePayload(response));
    setSearch(query);
  }

  return (
    <>
      <AccountForm
        submitLabel="Find communities"
        onSubmit={(fields) => loadCommunities(textField(fields, 'search'))}
      >
        <Field label="Community title" name="search" maxLength={200} />
      </AccountForm>
      {operation.error && <p role="alert">{operation.error}</p>}
      <ul>
        {results?.map((entry) => (
          <li key={entry.id}>
            <button type="button" onClick={() => setCommunity(entry)}>
              {entry.title}
            </button>
            <span> {entry.is_quarantined ? 'Quarantined' : entry.kind}</span>
          </li>
        ))}
      </ul>
      {results?.length === 50 && (
        <button
          type="button"
          onClick={() =>
            void operation.run({
              operation: () => loadCommunities(search, results.at(-1)?.id),
            })
          }
        >
          More communities
        </button>
      )}
      {community && (
        <OperatorActionForm
          owner={owner}
          label={community.is_quarantined ? 'Restore community' : 'Quarantine community'}
          action={() => ({
            kind: 'set_quarantine',
            target: { kind: 'community', conversation_id: community.id },
            is_quarantined: !community.is_quarantined,
          })}
          onCommitted={() => {
            setCommunity(undefined);
            void operation.run({ operation: () => loadCommunities(search) });
          }}
        />
      )}
    </>
  );
}

function JobOperations({ owner }: { owner: SessionOwner }) {
  const [kind, setKind] = useState<JobKind>('mail');
  const [jobs, setJobs] = useState<Job[]>();
  const [jobId, setJobId] = useState<string>();
  const operation = useOperation();

  function loadJobs() {
    setJobId(undefined);
    void operation.run({
      operation: async () => {
        const response = await owner.client.GET('/api/v1/operator/jobs', {
          params: { query: { kind } },
        });
        setJobs(requirePayload(response));
      },
    });
  }

  return (
    <>
      <label className={styles.field}>
        Job kind
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as JobKind);
            setJobId(undefined);
            setJobs(undefined);
          }}
        >
          <option value="mail">Mail</option>
          <option value="sync_wakeup">Sync wakeup</option>
          <option value="media">Media</option>
          <option value="push">Web Push</option>
        </select>
      </label>
      <button type="button" disabled={operation.isPending} onClick={loadJobs}>
        Load failed jobs
      </button>
      {operation.error && <p role="alert">{operation.error}</p>}
      {jobs?.length === 0 && <p>No failed jobs.</p>}
      <ul>
        {jobs?.map((job) => (
          <li key={job.id}>
            {job.failure_code} · {job.attempts} attempts
            {job.can_retry && (
              <button type="button" onClick={() => setJobId(job.id)}>
                Select for retry
              </button>
            )}
          </li>
        ))}
      </ul>
      {jobId && (
        <OperatorActionForm
          owner={owner}
          label="Retry job"
          action={() => ({ kind: 'retry_job', job_kind: kind, job_id: jobId })}
          onCommitted={loadJobs}
        />
      )}
    </>
  );
}

/** Keep platform operations within the existing connected account workspace. */
export function OperatorWorkspace({ owner }: { owner: SessionOwner }) {
  const [page, setPage] = useState<OperatorPage>('cases');
  const [registrationOpen, setRegistrationOpen] = useState<boolean>();
  const actions = useOperation();

  function refreshRegistration() {
    void actions.run({
      operation: async () => {
        const response = await owner.client.GET('/api/v1/capabilities');
        setRegistrationOpen(requirePayload(response).registration_open);
      },
    });
  }

  return (
    <div className={styles.panel}>
      <PasswordConfirmation owner={owner} />
      <section className={styles.card}>
        <h2>Platform administration</h2>
        <nav className={styles.navigation} aria-label="Operator navigation">
          {Object.entries(PAGES).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setPage(id as OperatorPage)}>
              {label}
            </button>
          ))}
        </nav>
        {page === 'cases' && <ReportCases owner={owner} />}
        {page === 'accounts' && <AccountOperations owner={owner} />}
        {page === 'communities' && <CommunityOperations owner={owner} />}
        {page === 'jobs' && <JobOperations owner={owner} />}
        {page === 'registration' && (
          <>
            <button type="button" onClick={refreshRegistration}>
              Load registration policy
            </button>
            {actions.error && <p role="alert">{actions.error}</p>}
            {registrationOpen !== undefined && (
              <OperatorActionForm
                owner={owner}
                label={registrationOpen ? 'Close registration' : 'Open registration'}
                action={() => ({ kind: 'set_registration', is_open: !registrationOpen })}
                onCommitted={refreshRegistration}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
