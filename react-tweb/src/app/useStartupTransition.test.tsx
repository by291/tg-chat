// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStartupTransition } from './useStartupTransition';

const ROW_HEIGHT = 72;
const VISIBLE_ROW_COUNT = 10;
const TOTAL_ROW_COUNT = 12;

let startupFrame: HTMLDivElement;
let conversationList: HTMLElement;

function addConversationRows() {
  conversationList = document.createElement('nav');
  document.body.append(conversationList);
  vi.spyOn(conversationList, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 320, VISIBLE_ROW_COUNT * ROW_HEIGHT),
  );

  return Array.from({ length: TOTAL_ROW_COUNT }, (_, index) => {
    const row = document.createElement('button');
    row.dataset.conversationIndex = String(index);
    row.textContent = `Conversation ${index}`;
    conversationList.append(row);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, index * ROW_HEIGHT, 320, ROW_HEIGHT),
    );
    return row;
  });
}

beforeEach(() => {
  startupFrame = document.createElement('div');
  startupFrame.id = 'startup-frame';
  document.body.append(startupFrame);
});

afterEach(() => {
  cleanup();
  startupFrame.remove();
  conversationList?.remove();
  vi.restoreAllMocks();
});

it('retains the initial frame until content is ready, then fades it out and removes it', async () => {
  const view = renderHook(useStartupTransition, {
    initialProps: { isReady: false, shouldReduceMotion: false },
    wrapper: StrictMode,
  });
  expect(startupFrame.isConnected).toBe(true);

  view.rerender({ isReady: true, shouldReduceMotion: false });

  expect(startupFrame.isConnected).toBe(true);
  await waitFor(() => {
    const opacity = Number.parseFloat(startupFrame.style.opacity);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });
  await waitFor(() => expect(startupFrame.isConnected).toBe(false));

  view.rerender({ isReady: true, shouldReduceMotion: false });
  expect(document.getElementById('startup-frame')).toBeNull();
});

it('reveals ready content immediately when reduced motion is enabled', () => {
  renderHook(useStartupTransition, {
    initialProps: { isReady: true, shouldReduceMotion: true },
    wrapper: StrictMode,
  });

  expect(startupFrame.isConnected).toBe(false);
});

it('reveals visible rows in order while keeping them clickable and skipping offscreen rows', async () => {
  const rows = addConversationRows();
  const firstRow = rows[0];
  const lastVisibleRow = rows[VISIBLE_ROW_COUNT - 1];
  const offscreenRow = rows[VISIBLE_ROW_COUNT];
  const selectConversation = vi.fn();
  lastVisibleRow.addEventListener('click', selectConversation);
  const view = renderHook(useStartupTransition, {
    initialProps: { isReady: true, shouldReduceMotion: false },
    wrapper: StrictMode,
  });

  await waitFor(() => {
    const firstOpacity = Number.parseFloat(firstRow.style.opacity);
    const lastOpacity = Number.parseFloat(lastVisibleRow.style.opacity);
    expect(firstOpacity).toBeGreaterThan(0);
    expect(firstOpacity).toBeGreaterThan(lastOpacity);
  });
  lastVisibleRow.click();
  expect(selectConversation).toHaveBeenCalledOnce();
  expect(offscreenRow.style.opacity).toBe('');

  await waitFor(() => {
    expect(startupFrame.isConnected).toBe(false);
    expect(lastVisibleRow.style.opacity).toBe('');
  });
  view.rerender({ isReady: true, shouldReduceMotion: false });
  expect(firstRow.style.opacity).toBe('');
});

it('restores row visibility when reduced motion is enabled during the entrance', async () => {
  const rows = addConversationRows();
  const view = renderHook(useStartupTransition, {
    initialProps: { isReady: true, shouldReduceMotion: false },
    wrapper: StrictMode,
  });
  await waitFor(() => expect(rows[0].style.opacity).not.toBe(''));

  view.rerender({ isReady: true, shouldReduceMotion: true });

  expect(startupFrame.isConnected).toBe(false);
  for (const row of rows) {
    expect(row.style.opacity).toBe('');
  }
});
