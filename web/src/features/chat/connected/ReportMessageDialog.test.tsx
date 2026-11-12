// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { ToastViewport } from '@/components/Toast';
import { hideToast } from '@/components/toastStore';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { ReportMessageDialog } from './ReportMessageDialog';

type ReportInput = components['schemas']['ReportMessage'];

interface ReportDialogFixture {
  messageIds: string[];
  fetch: (request: Request) => Promise<Response>;
  onComplete?: (reportedIds: string[]) => void;
}

function renderReportDialog({ messageIds, fetch, onComplete }: ReportDialogFixture) {
  const session = new SessionOwner({ baseUrl: 'https://chat.test', fetch });

  function TestScreen() {
    const [isOpen, setIsOpen] = useState(true);

    return (
      <>
        {isOpen && (
          <ReportMessageDialog
            messageIds={messageIds}
            session={session}
            onClose={() => setIsOpen(false)}
            onComplete={onComplete}
          />
        )}
        <ToastViewport />
      </>
    );
  }

  return render(<TestScreen />);
}

function reportReceipt() {
  return Response.json(
    {
      case_id: '5a9732d6-0523-4ce4-b641-1cba4d59e742',
      evidence_expires_at: '2027-02-11T00:00:00Z',
    },
    { status: 201 },
  );
}

function holdReportReceipt() {
  let resolveReceipt: (response: Response) => void = () => undefined;
  const receipt = new Promise<Response>((resolve) => {
    resolveReceipt = resolve;
  });

  return { receipt, resolveReceipt };
}

afterEach(() => {
  cleanup();
  hideToast();
});

it('lets the reporter change the reason and keep an unsent note', async () => {
  const user = userEvent.setup();
  const fetch = vi.fn(async () => reportReceipt());
  renderReportDialog({ messageIds: ['message-one'], fetch });
  const dialog = within(screen.getByRole('dialog', { name: 'Report message' }));

  expect(dialog.queryByRole('textbox')).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Spam' }));
  const note = dialog.getByRole('textbox', { name: 'Note (optional)' });
  await user.type(note, 'Repeated unwanted messages');
  expect(dialog.getByText(/original attachments.*case.*90 days/i)).toBeTruthy();

  await user.click(dialog.getByRole('button', { name: 'Back' }));
  expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Spam' }));
  await user.click(dialog.getByRole('button', { name: 'Harassment' }));
  expect(dialog.getByDisplayValue('Repeated unwanted messages')).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it('retries only failed messages with their original operation IDs', async () => {
  const user = userEvent.setup();
  const requests: { path: string; body: ReportInput }[] = [];
  const middlePath = '/api/v1/messages/message-two/reports';
  const fetch = async (request: Request) => {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as ReportInput;
    requests.push({ path, body });

    if (path === middlePath && requests.length === 2) {
      // The server may have recorded the report before the response was lost.
      throw new TypeError('Connection closed');
    }

    return reportReceipt();
  };
  const onComplete = vi.fn();
  renderReportDialog({
    messageIds: ['message-one', 'message-two', 'message-three'],
    fetch,
    onComplete,
  });
  const dialog = within(screen.getByRole('dialog', { name: 'Report messages' }));
  await user.click(dialog.getByRole('button', { name: 'Harmful content' }));
  await user.type(dialog.getByRole('textbox', { name: 'Note (optional)' }), '  Evidence  ');
  await user.click(dialog.getByRole('button', { name: 'Submit report' }));

  expect((await dialog.findByRole('alert')).textContent).toMatch(/2 of 3 reports sent/i);
  expect(onComplete).not.toHaveBeenCalled();
  expect(requests.map(({ path }) => path)).toEqual([
    '/api/v1/messages/message-one/reports',
    middlePath,
    '/api/v1/messages/message-three/reports',
  ]);
  const operationIds = requests.map(({ body }) => body.operation_id);
  expect(new Set(operationIds).size).toBe(3);
  expect(requests[1].body).toMatchObject({ reason: 'harmful_content', note: 'Evidence' });

  await user.click(dialog.getByRole('button', { name: 'Retry report' }));

  const toast = await screen.findByRole('status');
  expect(toast.textContent).toBe('3 reports submitted');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(requests.slice(3)).toEqual([requests[1]]);
  expect(onComplete).toHaveBeenCalledExactlyOnceWith([
    'message-one',
    'message-two',
    'message-three',
  ]);
});

it('blocks dismissal and repeated submission while a report is in flight', async () => {
  const user = userEvent.setup();
  const { receipt, resolveReceipt } = holdReportReceipt();
  const fetch = vi.fn(async () => receipt);
  renderReportDialog({ messageIds: ['message-one'], fetch });
  const dialog = within(screen.getByRole('dialog', { name: 'Report message' }));

  await user.click(dialog.getByRole('button', { name: 'Other' }));
  const submit = dialog.getByRole<HTMLButtonElement>('button', { name: 'Submit report' });
  await user.click(submit);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  const form = submit.form;
  expect(form).toBeInstanceOf(HTMLFormElement);
  if (!form) {
    throw new Error('The report submit button must belong to a form');
  }

  fireEvent.submit(form);
  await user.keyboard('{Escape}');
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByRole('dialog', { name: 'Report message' })).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);

  resolveReceipt(reportReceipt());
  expect((await screen.findByRole('status')).textContent).toBe('Report submitted');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('stops pending reports when the dialog is removed during submission', async () => {
  const user = userEvent.setup();
  const { receipt, resolveReceipt } = holdReportReceipt();
  const fetch = vi.fn(async (_request: Request) => receipt);
  const onComplete = vi.fn();
  const view = renderReportDialog({
    messageIds: ['message-one', 'message-two'],
    fetch,
    onComplete,
  });
  const dialog = within(screen.getByRole('dialog', { name: 'Report messages' }));
  await user.click(dialog.getByRole('button', { name: 'Spam' }));
  await user.click(dialog.getByRole('button', { name: 'Submit report' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  view.unmount();
  await act(async () => resolveReceipt(reportReceipt()));

  expect(fetch.mock.calls[0][0].signal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onComplete).not.toHaveBeenCalled();
});
