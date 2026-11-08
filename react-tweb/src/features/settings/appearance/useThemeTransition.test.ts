// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runThemeTransition } from './useThemeTransition';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function installTransitions() {
  const callbacks: Array<() => void> = [];
  const transitions: Array<ReturnType<typeof deferred<void>>> = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (commit: () => void) => {
      const finished = deferred<void>();
      callbacks.push(commit);
      transitions.push(finished);
      return {
        ready: Promise.resolve(),
        finished: finished.promise,
        skipTransition: () => finished.resolve(),
      };
    },
  });
  return { callbacks, transitions };
}

beforeEach(() => {
  delete document.documentElement.dataset.themeTransition;
});

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('uses a document fade for settings changes without a circular origin', async () => {
  const browser = installTransitions();
  let visibleTheme = 'old';
  const completion = runThemeTransition({
    isDark: false,
    apply: () => {
      visibleTheme = 'new';
    },
  });
  browser.callbacks[0]();
  expect(visibleTheme).toBe('new');
  expect(document.documentElement.dataset.themeTransition).toBe('fade');
  browser.transitions[0].resolve();
  await completion;
  expect(document.documentElement.dataset.themeTransition).toBeUndefined();
});

it('keeps the old view until a new wallpaper is ready and discards a superseded request', async () => {
  const browser = installTransitions();
  const preparation = deferred<() => void>();
  const release = vi.fn();
  let visibleTheme = 'old';
  const oldSelection = runThemeTransition({
    isDark: false,
    prepare: () => preparation.promise,
    apply: () => {
      visibleTheme = 'image';
    },
  });
  expect(browser.callbacks).toHaveLength(0);
  expect(visibleTheme).toBe('old');

  const newSelection = runThemeTransition({
    isDark: false,
    apply: () => {
      visibleTheme = 'color';
    },
  });
  browser.callbacks[0]();
  preparation.resolve(release);
  await oldSelection;
  browser.transitions[0].resolve();
  await newSelection;
  expect(visibleTheme).toBe('color');
  expect(release).toHaveBeenCalledOnce();
});

it('retains the previous view when wallpaper preparation fails', async () => {
  installTransitions();
  const apply = vi.fn();
  await expect(
    runThemeTransition({
      isDark: false,
      prepare: () => Promise.reject(new Error('Image unavailable')),
      apply,
    }),
  ).rejects.toThrow('Image unavailable');
  expect(apply).not.toHaveBeenCalled();
});

it('ignores an obsolete browser snapshot callback after another selection', async () => {
  const browser = installTransitions();
  let visibleTheme = 'old';
  const older = runThemeTransition({
    isDark: false,
    apply: () => {
      visibleTheme = 'older';
    },
  });
  const newer = runThemeTransition({
    isDark: false,
    apply: () => {
      visibleTheme = 'newer';
    },
  });
  browser.callbacks[1]();
  browser.callbacks[0]();
  browser.transitions[1].resolve();
  await Promise.all([older, newer]);
  expect(visibleTheme).toBe('newer');
});

it('still prepares wallpaper pixels before an immediate reduced-motion change', async () => {
  const browser = installTransitions();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const preparation = deferred<() => void>();
  let visibleTheme = 'old';
  let isReleased = false;
  const completion = runThemeTransition({
    isDark: false,
    prepare: () => preparation.promise,
    apply: () => {
      visibleTheme = 'image';
    },
  });
  expect(visibleTheme).toBe('old');
  preparation.resolve(() => {
    isReleased = true;
  });
  await completion;
  expect(visibleTheme).toBe('image');
  expect(browser.callbacks).toHaveLength(0);
  expect(isReleased).toBe(true);
});
