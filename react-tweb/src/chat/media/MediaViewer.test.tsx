// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { getGalleryMessages } from './photoGallery';
import { MediaViewer } from './MediaViewer';

const album = createInitialState().messages.find((message) => message.media?.kind === 'album')!;
const photos = getGalleryMessages([album]);

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function GalleryScreen({ onClose = () => {} }: { onClose?: () => void }) {
  const [message, setMessage] = useState(photos[0]);
  return (
    <MediaViewer
      message={message}
      messages={[album]}
      onNavigate={setMessage}
      onClose={onClose}
      onCommand={() => {}}
      onNotify={() => {}}
    />
  );
}

it('keeps navigation available after clicking the selected album photo', async () => {
  render(<GalleryScreen />);
  const next = await screen.findByRole('button', { name: 'Next media' });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'View album photo 1' }));
  fireEvent.click(next);
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'View album photo 2' }).getAttribute('aria-current'),
    ).toBe('true');
  });
});

it('keeps keyboard navigation inside the viewer after clicking an arrow', async () => {
  render(<GalleryScreen />);
  const next = await screen.findByRole('button', { name: 'Next media' });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  next.focus();
  fireEvent.click(next);
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'View album photo 1' }).getAttribute('aria-current'),
    ).toBe('true');
  });
});

it('closes when the fixed viewer background outside the transformed media is clicked', async () => {
  const onClose = vi.fn();
  render(<GalleryScreen onClose={onClose} />);
  const rotate = await screen.findByRole('button', { name: 'Rotate left' });
  await waitFor(() => expect((rotate as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(rotate);
  fireEvent.click(screen.getByRole('dialog'), { detail: 1 });
  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps the viewer open when clicking its caption or toolbar', async () => {
  const onClose = vi.fn();
  render(<GalleryScreen onClose={onClose} />);
  const rotate = await screen.findByRole('button', { name: 'Rotate left' });
  await waitFor(() => expect((rotate as HTMLButtonElement).disabled).toBe(false));
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByText(album.text), { detail: 1 });
    fireEvent.click(screen.getByRole('banner'), { detail: 1 });
    act(() => vi.runAllTimers());
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('keeps mobile double-tap zoom from closing the viewer', async () => {
  vi.stubGlobal('innerWidth', 390);
  const onClose = vi.fn();
  render(<GalleryScreen onClose={onClose} />);
  const zoom = await screen.findByRole('button', { name: 'Zoom in' });
  await waitFor(() => expect((zoom as HTMLButtonElement).disabled).toBe(false));
  vi.useFakeTimers();
  try {
    const image = screen.getByAltText(photos[0].attachment!.name);
    fireEvent.click(image, { detail: 1 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(image, { detail: 2 });
    fireEvent.doubleClick(image);
    act(() => vi.runAllTimers());
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('closes the mobile menu on desktop resize so gallery navigation remains available', async () => {
  let isMobile = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('max-width') ? isMobile : true;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  render(<GalleryScreen />);
  const next = await screen.findByRole('button', { name: 'Next media' });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Media options' }));
  await screen.findByRole('menu');
  act(() => {
    isMobile = false;
    for (const notify of listeners) {
      notify();
    }
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.click(next);
  await waitFor(() => {
    const selectedPhoto = screen.getByRole('button', { name: 'View album photo 2' });
    expect(selectedPhoto.getAttribute('aria-current')).toBe('true');
  });
});

it('closes immediately on a desktop photo click without waiting for a double click', async () => {
  const onClose = vi.fn();
  render(<GalleryScreen onClose={onClose} />);
  const zoom = await screen.findByRole('button', { name: 'Zoom in' });
  await waitFor(() => expect((zoom as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByAltText(photos[0].attachment!.name), { detail: 1 });
  expect(onClose).toHaveBeenCalledOnce();
});
