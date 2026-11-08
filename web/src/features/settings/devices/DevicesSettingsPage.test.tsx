// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readDeviceName, saveDeviceName } from './currentDevice';
import { DevicesSettingsPage } from './DevicesSettingsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('saves a device name across remounts without applying a canceled rename', async () => {
  const firstView = render(<DevicesSettingsPage onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Device Name' }), {
    target: { value: 'Work browser' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(readDeviceName()).toBe('Work browser');

  firstView.unmount();

  render(<DevicesSettingsPage onBack={() => {}} />);

  expect(screen.getByRole('button', { name: 'View current device' }).textContent).toContain(
    'Work browser',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Device Name' }), {
    target: { value: 'Canceled name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  expect(readDeviceName()).toBe('Work browser');
});

it('keeps the rename dialog open if the new name cannot be saved', async () => {
  saveDeviceName('Original');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  render(<DevicesSettingsPage onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Device Name' }), {
    target: { value: 'Unsaved' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(readDeviceName()).toBe('Original');
});

it('keeps server actions unavailable and returns from details before leaving settings', () => {
  const onBack = vi.fn();
  render(<DevicesSettingsPage onBack={onBack} />);
  const terminate = screen.getByRole('button', { name: 'Terminate All Other Sessions' });

  expect(terminate.hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: /If Inactive For/ }).hasAttribute('disabled')).toBe(
    true,
  );

  fireEvent.click(screen.getByRole('button', { name: 'View current device' }));

  expect(screen.getByRole('region', { name: 'Device details' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Incoming Calls' }).hasAttribute('disabled')).toBe(
    true,
  );

  fireEvent.keyDown(screen.getByRole('button', { name: 'Back from device details' }), {
    key: 'Escape',
  });

  expect(screen.getByRole('button', { name: 'View current device' })).toBeTruthy();
  expect(onBack).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Back from devices' }));

  expect(onBack).toHaveBeenCalledOnce();
});
