// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { OperatorWorkspace } from './OperatorWorkspace';

type CaseSummary = components['schemas']['CaseSummary'];
type CaseDetail = components['schemas']['CaseDetail'];

const CASE: CaseSummary = {
  id: '20000000-0000-4000-8000-000000000001',
  conversation_id: '20000000-0000-4000-8000-000000000002',
  message_id: '20000000-0000-4000-8000-000000000003',
  reporter_id: '20000000-0000-4000-8000-000000000004',
  reported_author_id: '20000000-0000-4000-8000-000000000005',
  created_at: '2026-11-12T11:42:00Z',
  evidence_expires_at: '2027-02-10T11:42:00Z',
  reason: 'other',
  resolved_at: null,
};
const CASES_PATH = '/api/v1/operator/cases';
const CASE_PATH = `${CASES_PATH}/${CASE.id}`;
const COMMANDS_PATH = '/api/v1/operator/commands';
const REAUTHENTICATE_PATH = '/api/v1/auth/reauthenticate';

function recentPasswordRequired(): Response {
  return Response.json(
    {
      error: {
        code: 'recent_authentication_required',
        message: 'recent password authentication is required',
        request_id: 'request',
      },
    },
    { status: 403 },
  );
}

afterEach(cleanup);

it('reloads the queue after password confirmation unlocks it', async () => {
  let hasRecentPassword = false;
  const owner = new SessionOwner({
    baseUrl: 'https://chat.example.test',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === REAUTHENTICATE_PATH && request.method === 'POST') {
        hasRecentPassword = true;
        return new Response(null, { status: 204 });
      }
      if (path === CASES_PATH && hasRecentPassword) {
        return Response.json({ items: [CASE], next: null });
      }
      return recentPasswordRequired();
    },
  });
  render(<OperatorWorkspace owner={owner} />);

  const password = await screen.findByLabelText('Password confirmation');
  fireEvent.change(password, { target: { value: 'operator password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));

  const report = await screen.findByRole('button', { name: 'Review other report' });
  expect(within(report).getByText('Open')).toBeTruthy();
  expect(screen.queryByLabelText('Password confirmation')).toBeNull();
});

it('shows the resolved status in the queue after committing a case resolution', async () => {
  let report = CASE;
  const owner = new SessionOwner({
    baseUrl: 'https://chat.example.test',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === CASES_PATH) {
        return Response.json({ items: [report], next: null });
      }
      if (path === COMMANDS_PATH && request.method === 'POST') {
        report = { ...CASE, resolved_at: '2026-11-13T02:15:00Z' };
        return new Response(null, { status: 204 });
      }
      if (path === CASE_PATH) {
        const detail: CaseDetail = {
          case: report,
          evidence: {
            message_text: 'Retained message',
            message_version: '5',
            reporter_note: 'Retained explanation',
          },
          attachments: [],
        };
        return Response.json(detail);
      }
      throw new Error(`Unexpected request to ${path}`);
    },
  });
  render(<OperatorWorkspace owner={owner} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review other report' }));

  const resolve = await screen.findByRole('button', { name: 'Resolve case' });
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Case evidence' }));
  const form = resolve.closest('form')!;
  fireEvent.change(within(form).getByLabelText('Reason'), {
    target: { value: 'Reviewed retained evidence' },
  });
  fireEvent.click(resolve);
  await screen.findByText('Case resolved.');
  fireEvent.click(screen.getByRole('button', { name: 'Back to reports' }));

  const row = await screen.findByRole('button', { name: 'Review other report' });
  expect(within(row).getByText('Resolved')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Reported messages' }));
});

it('hides stale evidence and preserves the pending action reason through reauth', async () => {
  const reason = 'The reviewed message requires quarantine';
  const reportedMessage = 'Private retained message';
  let hasRecentPassword = false;
  const owner = new SessionOwner({
    baseUrl: 'https://chat.example.test',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === CASES_PATH) {
        return Response.json({ items: [CASE], next: null });
      }
      if (path === CASE_PATH) {
        const detail: CaseDetail = {
          case: CASE,
          evidence: {
            message_text: reportedMessage,
            message_version: '2',
            reporter_note: 'Please review',
            structured_body: {
              kind: 'poll_snapshot',
              question: 'Which option should we choose?',
              options: [{ id: 'first', text: 'First poll option' }],
            },
          },
          attachments: [],
        };
        return Response.json(detail);
      }
      if (path === REAUTHENTICATE_PATH) {
        hasRecentPassword = true;
        return new Response(null, { status: 204 });
      }
      if (path === COMMANDS_PATH && hasRecentPassword) {
        const command = await request.json();
        if (command.reason === reason && command.action.is_quarantined) {
          return new Response(null, { status: 204 });
        }
        throw new Error('The action did not preserve its reason.');
      }
      return recentPasswordRequired();
    },
  });
  render(<OperatorWorkspace owner={owner} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review other report' }));
  await screen.findByText('First poll option');

  const actionName = 'Change conversation quarantine';
  const action = screen.getByRole('button', { name: actionName });
  const form = action.closest('form')!;
  fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: reason } });
  fireEvent.click(action);

  const password = await screen.findByLabelText('Password confirmation');
  expect(screen.queryByText(reportedMessage)).toBeNull();
  expect(screen.queryByText('First poll option')).toBeNull();

  fireEvent.change(password, { target: { value: 'operator password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));

  const retry = await screen.findByRole('button', { name: actionName });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(retry);
  await screen.findByText('Conversation quarantined.');
});
