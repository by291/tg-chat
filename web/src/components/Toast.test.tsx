// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastViewport } from './Toast';
import { hideToast, showToast } from './toastStore';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  hideToast();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

it('replaces the current message and renews its lifetime without stacking', () => {
  render(<ToastViewport />);
  act(() => showToast('Email copied'));
  act(() => vi.advanceTimersByTime(2500));
  act(() => showToast('Username copied'));
  act(() => vi.advanceTimersByTime(1000));

  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('Username copied');

  act(() => showToast('Username copied'));
  act(() => vi.advanceTimersByTime(2500));

  expect(screen.getByRole('status').textContent).toBe('Username copied');
});

it('keeps the closing toast mounted for its fade and can reopen the same message', () => {
  render(<ToastViewport />);
  act(() => showToast('Copied'));
  act(() => vi.advanceTimersByTime(3000));

  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('Copied')).toBeTruthy();

  act(() => showToast('Copied'));
  act(() => vi.advanceTimersByTime(200));

  expect(screen.getByRole('status').textContent).toBe('Copied');

  act(() => vi.advanceTimersByTime(3000));

  expect(screen.queryByText('Copied')).toBeNull();
});

it('consumes an outside pointer click but lets keyboard activation reach its control', () => {
  const activate = vi.fn();
  render(
    <>
      <button onClick={activate}>Action</button>
      <ToastViewport />
    </>,
  );
  act(() => showToast('Copied'));
  fireEvent.click(screen.getByRole('button', { name: 'Action' }), { detail: 1 });

  expect(activate).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();

  act(() => showToast('Copied'));
  fireEvent.click(screen.getByRole('button', { name: 'Action' }), { detail: 0 });

  expect(activate).toHaveBeenCalledOnce();
  expect(screen.queryByRole('status')).toBeNull();
});

it('dismisses on Escape without closing the panel beneath it', () => {
  const closePanel = vi.fn();
  render(
    <div onKeyDown={closePanel}>
      <button>Back</button>
      <ToastViewport />
    </div>,
  );
  act(() => showToast('Copied'));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Back' }), { key: 'Escape' });

  expect(closePanel).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});

it('dismisses a passive message alert while allowing the outside pointer action', () => {
  const openConversation = vi.fn();
  render(
    <>
      <button onClick={openConversation}>Open conversation</button>
      <ToastViewport />
    </>,
  );

  act(() => showToast('New message', { isPassive: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }), { detail: 1 });

  expect(openConversation).toHaveBeenCalledOnce();
  expect(screen.queryByRole('status')).toBeNull();
});
