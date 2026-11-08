import { describe, expect, it } from 'vitest';
import { canMarkLatestRead, shouldLoadOlderHistory } from './historyViewportPolicy';

const viewport = {
  scrollTop: 600,
  scrollHeight: 1000,
  clientHeight: 400,
  clientWidth: 700,
};
const activity = {
  isInitialized: true,
  isResizing: false,
  isNavigating: false,
};
const reading = {
  activity,
  viewport,
  isPageVisible: true,
  hasPageFocus: true,
};
const pagination = {
  activity,
  viewport: { ...viewport, scrollTop: 400 },
  hasUserInteracted: true,
  hasOlder: true,
  scrollDirection: 'backward' as const,
  firstRowKey: 'earliest-loaded-message',
  requestedStartKey: undefined,
};

describe('visible history read policy', () => {
  it('marks the rendered bottom read, allowing fractional pixel measurement error', () => {
    expect(canMarkLatestRead(reading)).toBe(true);
    expect(canMarkLatestRead({ ...reading, viewport: { ...viewport, scrollTop: 599.5 } })).toBe(
      true,
    );
    expect(canMarkLatestRead({ ...reading, viewport: { ...viewport, scrollTop: 598 } })).toBe(
      false,
    );
  });

  it('does not read messages from a background or unfocused page', () => {
    expect(canMarkLatestRead({ ...reading, isPageVisible: false })).toBe(false);
    expect(canMarkLatestRead({ ...reading, hasPageFocus: false })).toBe(false);
  });

  it('waits until navigation, resizing, and initialization have settled', () => {
    expect(canMarkLatestRead({ ...reading, activity: { ...activity, isNavigating: true } })).toBe(
      false,
    );
    expect(canMarkLatestRead({ ...reading, activity: { ...activity, isResizing: true } })).toBe(
      false,
    );
    expect(canMarkLatestRead({ ...reading, activity: { ...activity, isInitialized: false } })).toBe(
      false,
    );
  });

  it('does not read from an absent or collapsed viewport', () => {
    expect(canMarkLatestRead({ ...reading, viewport: undefined })).toBe(false);
    expect(canMarkLatestRead({ ...reading, viewport: { ...viewport, clientWidth: 0 } })).toBe(
      false,
    );
    expect(canMarkLatestRead({ ...reading, viewport: { ...viewport, clientHeight: 0 } })).toBe(
      false,
    );
  });
});

describe('older history prefetch policy', () => {
  it('prefetches within one viewport of the loaded boundary while moving toward it', () => {
    expect(shouldLoadOlderHistory(pagination)).toBe(true);
    expect(shouldLoadOlderHistory({ ...pagination, scrollDirection: null })).toBe(true);
    expect(shouldLoadOlderHistory({ ...pagination, scrollDirection: 'forward' })).toBe(false);
    expect(
      shouldLoadOlderHistory({ ...pagination, viewport: { ...viewport, scrollTop: 401 } }),
    ).toBe(false);
  });

  it('keeps a minimum prefetch distance for short viewports', () => {
    const shortViewport = { ...viewport, clientHeight: 200, scrollTop: 350 };
    expect(shouldLoadOlderHistory({ ...pagination, viewport: shortViewport })).toBe(true);
  });

  it('requests each loaded boundary once and accepts the next boundary', () => {
    expect(
      shouldLoadOlderHistory({ ...pagination, requestedStartKey: pagination.firstRowKey }),
    ).toBe(false);
    expect(shouldLoadOlderHistory({ ...pagination, requestedStartKey: 'previous-boundary' })).toBe(
      true,
    );
    expect(shouldLoadOlderHistory({ ...pagination, firstRowKey: undefined })).toBe(false);
  });

  it('does not prefetch before user interaction or while navigation owns position', () => {
    expect(shouldLoadOlderHistory({ ...pagination, hasUserInteracted: false })).toBe(false);
    expect(
      shouldLoadOlderHistory({ ...pagination, activity: { ...activity, isNavigating: true } }),
    ).toBe(false);
    expect(
      shouldLoadOlderHistory({ ...pagination, activity: { ...activity, isResizing: true } }),
    ).toBe(false);
    expect(
      shouldLoadOlderHistory({ ...pagination, activity: { ...activity, isInitialized: false } }),
    ).toBe(false);
  });

  it('stops when history is exhausted or the viewport is unmounted', () => {
    expect(shouldLoadOlderHistory({ ...pagination, hasOlder: false })).toBe(false);
    expect(shouldLoadOlderHistory({ ...pagination, viewport: undefined })).toBe(false);
  });
});
