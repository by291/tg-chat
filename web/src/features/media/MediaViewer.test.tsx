// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import type { Message } from '@/domain/messages/message';
import { VideoFrame } from '@/features/chat/messages/content/media/VideoMessage';
import { getGalleryMessages } from './photoGallery';
import { MediaViewer } from './MediaViewer';

const album = createInitialState().messages.find((message) => message.media?.kind === 'album')!;
const photos = getGalleryMessages([album]);

const videoMessage: Message = {
  ...photos[0],
  id: 'background-video',
  attachment: undefined,
  media: {
    kind: 'video',
    url: '/background.mp4',
    poster: '/poster.jpg',
    width: 640,
    height: 360,
    duration: 30,
  },
};

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
  vi.restoreAllMocks();
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

function BackgroundVideoScreen({
  message,
  isRound = false,
}: {
  message?: Message;
  isRound?: boolean;
}) {
  if (videoMessage.media?.kind !== 'video') {
    throw new Error('The playback fixture requires a video.');
  }
  return (
    <>
      <VideoFrame media={{ ...videoMessage.media, isRound }} hasCaption={false} />
      <MediaViewer
        message={message}
        messages={[...photos, videoMessage]}
        onNavigate={() => {}}
        onClose={() => {}}
        onCommand={() => {}}
        onNotify={() => {}}
      />
    </>
  );
}

function configureVideoPlayback() {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback(
          [{ target, isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }

      disconnect() {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
}

function dispatchViewerAnimation({
  dialog,
  type,
  name,
}: {
  dialog: HTMLElement;
  type: string;
  name: string;
}) {
  const animationEvent = new Event(type, { bubbles: true });
  Object.defineProperty(animationEvent, 'animationName', { value: name });
  fireEvent(dialog, animationEvent);
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

it('pauses unrelated chat videos until the photo viewer finishes its exit animation', async () => {
  configureVideoPlayback();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const animationStyles = document.createElement('style');
  animationStyles.textContent = `
    [data-scope='dialog'][data-part='content'][data-state='open'] {
      animation-name: viewer-enter;
      animation-duration: 200ms;
    }
    [data-scope='dialog'][data-part='content'][data-state='closed'] {
      animation-name: viewer-exit;
      animation-duration: 200ms;
    }
  `;
  document.head.append(animationStyles);

  try {
    const { container, rerender } = render(<BackgroundVideoScreen />);
    const backgroundVideo = container.querySelector('video')!;
    await waitFor(() => expect(backgroundVideo.paused).toBe(false));

    rerender(<BackgroundVideoScreen message={photos[0]} />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(backgroundVideo.paused).toBe(true));
    dispatchViewerAnimation({
      dialog,
      type: 'animationstart',
      name: 'viewer-enter',
    });
    act(() => vi.runOnlyPendingTimers());

    rerender(<BackgroundVideoScreen />);
    await waitFor(() => expect(dialog.dataset.state).toBe('closed'));
    act(() => vi.runOnlyPendingTimers());
    expect(dialog.isConnected).toBe(true);
    expect(backgroundVideo.paused).toBe(true);

    dispatchViewerAnimation({
      dialog,
      type: 'animationend',
      name: 'viewer-exit',
    });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(backgroundVideo.paused).toBe(false);
  } finally {
    animationStyles.remove();
    vi.useRealTimers();
  }
});

it('keeps the viewer video playing while unrelated chat previews are paused', async () => {
  configureVideoPlayback();
  const { container } = render(<BackgroundVideoScreen message={videoMessage} />);
  const backgroundVideo = container.querySelector('video')!;
  const dialog = await screen.findByRole('dialog');
  const viewerVideo = dialog.querySelector('video')!;

  await waitFor(() => expect(viewerVideo.paused).toBe(false));
  expect(backgroundVideo.paused).toBe(true);
});

it('pauses round playback behind the viewer and requires manual resume after close', async () => {
  configureVideoPlayback();
  const { container, rerender } = render(<BackgroundVideoScreen isRound />);
  const roundVideo = container.querySelector('video')!;
  fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
  await waitFor(() => expect(roundVideo.muted).toBe(false));
  expect(roundVideo.paused).toBe(false);

  rerender(<BackgroundVideoScreen message={photos[0]} isRound />);
  await screen.findByRole('dialog');
  expect(roundVideo.paused).toBe(true);

  rerender(<BackgroundVideoScreen isRound />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(roundVideo.paused).toBe(true);
});
