import { z } from 'zod';
import type { components } from '@/api/schema';
import styles from './OperatorWorkspace.module.css';

type CaseDetail = components['schemas']['CaseDetail'];

const BODY = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('poll_snapshot'),
    question: z.string(),
    description: z.string().optional(),
    options: z.array(z.object({ id: z.string(), text: z.string() })),
  }),
  z.object({
    kind: z.literal('checklist_snapshot'),
    title: z.string(),
    tasks: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        is_complete: z.boolean(),
      }),
    ),
  }),
  z.object({
    kind: z.literal('contact'),
    display_name: z.string(),
    phone: z.string().nullish(),
  }),
  z.object({ kind: z.literal('sticker'), sticker_id: z.string() }),
]);

function caseDownload(caseId: string, occurrenceId: string): string {
  const casePath = encodeURIComponent(caseId);
  const attachmentPath = encodeURIComponent(occurrenceId);
  return `/api/v1/operator/cases/${casePath}/attachments/${attachmentPath}`;
}

function CapturedBody({ snapshot }: { snapshot: unknown }) {
  if (snapshot == null) {
    return null;
  }
  const parsed = BODY.safeParse(snapshot);
  if (!parsed.success) {
    return <p>This message format is unavailable in the evidence viewer.</p>;
  }

  const body = parsed.data;
  switch (body.kind) {
    case 'poll_snapshot':
      return (
        <div>
          <p>
            <strong>Poll:</strong> {body.question}
          </p>
          {body.description && <p>{body.description}</p>}
          <ul>
            {body.options.map((option) => (
              <li key={option.id}>{option.text}</li>
            ))}
          </ul>
        </div>
      );
    case 'checklist_snapshot':
      return (
        <div>
          <p>
            <strong>Checklist:</strong> {body.title}
          </p>
          <ul>
            {body.tasks.map((task) => (
              <li key={task.id}>
                {task.text} · {task.is_complete ? 'Done' : 'Incomplete'}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'contact':
      return (
        <div>
          <p>
            <strong>Shared contact:</strong> {body.display_name}
          </p>
          {body.phone && <p>{body.phone}</p>}
        </div>
      );
    case 'sticker':
      return <p>Sticker: {body.sticker_id}</p>;
  }
}

/** Display the retained message and case-scoped original files available for review. */
export function CaseEvidence({ detail }: { detail: CaseDetail }) {
  const { evidence, attachments } = detail;
  if (!evidence) {
    return <p>Evidence has expired.</p>;
  }

  const deadline = detail.case.evidence_expires_at;
  return (
    <div className={styles.evidence}>
      <h4>Reported message</h4>
      {evidence.message_text && <p className={styles.messageText}>{evidence.message_text}</p>}
      <CapturedBody snapshot={evidence.structured_body} />
      {evidence.reporter_note && (
        <p className={styles.messageText}>Report note: {evidence.reporter_note}</p>
      )}
      {attachments.length > 0 && (
        <>
          <h4>Original attachments</h4>
          <ul>
            {attachments.map((file) => (
              <li key={file.occurrence_id}>
                <a
                  href={caseDownload(detail.case.id, file.occurrence_id)}
                  download={file.file_name}
                >
                  Download {file.file_name}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        Evidence expires <time dateTime={deadline}>{new Date(deadline).toLocaleString()}</time>.
      </p>
    </div>
  );
}
