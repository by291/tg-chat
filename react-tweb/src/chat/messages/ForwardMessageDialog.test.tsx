// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { ForwardMessageDialog } from './ForwardMessageDialog';

afterEach(cleanup);

it('accepts one destination while the picker is closing', async () => {
  const onChooseRecipient = vi.fn();
  render(
    <ForwardMessageDialog
      state={createInitialState()}
      onClose={vi.fn()}
      onChooseRecipient={onChooseRecipient}
      onSend={vi.fn()}
    />,
  );
  const recipient = screen.getByRole('button', { name: /^dev/ });
  fireEvent.click(recipient);
  fireEvent.click(recipient);

  await waitFor(() => expect(onChooseRecipient).toHaveBeenCalledOnce());
  expect(onChooseRecipient.mock.calls[0][0].id).toBe('dev');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('cancels without choosing a recipient when closed from its header', async () => {
  const onClose = vi.fn();
  const onChooseRecipient = vi.fn();
  render(
    <ForwardMessageDialog
      state={createInitialState()}
      onClose={onClose}
      onChooseRecipient={onChooseRecipient}
      onSend={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close forwarding' }));

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onChooseRecipient).not.toHaveBeenCalled();
});

it('sends the selected destinations only once while closing', async () => {
  const onSend = vi.fn();
  render(
    <ForwardMessageDialog
      state={createInitialState()}
      onClose={vi.fn()}
      onChooseRecipient={vi.fn()}
      onSend={onSend}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select recipients' }));
  fireEvent.click(screen.getByRole('button', { name: /^dev/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Mia Chen/ }));
  const send = screen.getByRole('button', { name: 'Send forwarded messages' });
  fireEvent.click(send);
  fireEvent.click(send);

  await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  const recipients = onSend.mock.calls[0][0].recipients;
  expect(recipients.map((recipient: { id: string }) => recipient.id)).toEqual(['dev', 'mia']);
  expect(onSend.mock.calls[0][0].caption).toBe('');
});
