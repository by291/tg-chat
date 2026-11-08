// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { describeCurrentDevice, readDeviceName, saveDeviceName } from './currentDevice';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('distinguishes Edge from its embedded Chrome user agent', () => {
  const device = describeCurrentDevice({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    maxTouchPoints: 0,
  });

  expect(device).toEqual({ browser: 'Microsoft Edge 130', system: 'Windows' });
});

it('recognizes an iPad using a desktop Safari user agent', () => {
  const device = describeCurrentDevice({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Safari/605.1.15',
    maxTouchPoints: 5,
  });

  expect(device).toEqual({ browser: 'Safari 18', system: 'iPadOS' });
});

it('keeps unknown environments generic rather than claiming a device identity', () => {
  expect(describeCurrentDevice({ userAgent: '', maxTouchPoints: 0 })).toEqual({
    browser: 'Web browser',
    system: 'Unknown system',
  });
});

it('persists a trimmed name and restores the default when cleared', () => {
  expect(saveDeviceName('  Work browser  ')).toBe(true);
  expect(readDeviceName()).toBe('Work browser');
  expect(saveDeviceName(' ')).toBe(true);
  expect(readDeviceName()).toBe('');
});

it('reports blocked storage without crashing device settings', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });

  expect(readDeviceName()).toBe('');
  expect(saveDeviceName('Work browser')).toBe(false);
});
