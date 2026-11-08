// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../../demo/fixtures';
import { ForwardMessageDialog } from './ForwardMessageDialog';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

it('keeps recipients in selection order and appends a reselected recipient at the end', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: /^Mia Chen/ }));
  fireEvent.click(screen.getByRole('button', { name: /^dev/ }));

  const selectedNames = () => {
    return screen.getAllByRole('button', { name: /^Remove / }).map((button) => {
      return button.getAttribute('aria-label');
    });
  };
  expect(selectedNames()).toEqual(['Remove Mia Chen', 'Remove dev']);

  fireEvent.click(screen.getByRole('button', { name: 'Remove Mia Chen' }));
  expect(screen.getByRole('button', { name: /^Mia Chen/ }).getAttribute('aria-pressed')).toBe(
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: /^Mia Chen/ }));
  expect(selectedNames()).toEqual(['Remove dev', 'Remove Mia Chen']);
  fireEvent.click(screen.getByRole('button', { name: 'Send forwarded messages' }));

  await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  const recipients = onSend.mock.calls[0][0].recipients;
  expect(recipients.map((recipient: { id: string }) => recipient.id)).toEqual(['dev', 'mia']);
});

it('excludes a departing chip from the selection before its exit finishes', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Remove dev' }));
  expect(screen.queryByRole('button', { name: 'Remove dev' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send forwarded messages' }));

  await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  const recipients = onSend.mock.calls[0][0].recipients;
  expect(recipients.map((recipient: { id: string }) => recipient.id)).toEqual(['mia']);
});
