// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAnimationPlayback } from '@/features/stickers/stickerPlayback';
import { setAppPreferences } from '@/features/settings/appPreferences';
import { VideoFrame } from './MessageMediaFrames';

const videoMedia = {
  kind: 'video' as const,
  url: '/clip.mp4',
  poster: '/poster.jpg',
  width: 1280,
  height: 720,
  duration: 20,
};

let notifyVisibility: IntersectionObserverCallback;
const visibilityObservers = new Map<Element, IntersectionObserverCallback>();

beforeEach(() => {
  visibilityObservers.clear();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        notifyVisibility = callback;
      }

      observe(target: Element) {
        visibilityObservers.set(target, this.callback);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
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
});

afterEach(() => {
  cleanup();
  setAppPreferences({ shouldAutoplayVideos: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createVisibilityEntry({
  target,
  isIntersecting,
}: {
  target: Element;
  isIntersecting: boolean;
}): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();
  return {
    target,
    isIntersecting,
    boundingClientRect: bounds,
    intersectionRect: bounds,
    intersectionRatio: isIntersecting ? 1 : 0,
    rootBounds: null,
    time: performance.now(),
  };
}

function showVideo() {
  act(() => {
    for (const [target, notify] of visibilityObservers) {
      notify([createVisibilityEntry({ target, isIntersecting: true })], {} as IntersectionObserver);
    }
  });
}

describe('video message playback', () => {
  it('pauses previews when autoplay is disabled but permits explicit round playback', async () => {
    const { container } = render(
      <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />,
    );
    showVideo();
    const video = container.querySelector('video')!;
    expect(video.paused).toBe(false);
    act(() => setAppPreferences({ shouldAutoplayVideos: false }));
    expect(video.paused).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Play/ })));
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
  });

  it('uses the final batched visibility when scrolling out of the viewport', () => {
    const { container } = render(<VideoFrame media={videoMedia} hasCaption={false} />);
    showVideo();
    const video = container.querySelector('video')!;

    act(() => {
      notifyVisibility(
        [
          createVisibilityEntry({ target: video, isIntersecting: true }),
          createVisibilityEntry({ target: video, isIntersecting: false }),
        ],
        {} as IntersectionObserver,
      );
    });

    expect(video.paused).toBe(true);
    showVideo();
    expect(video.paused).toBe(false);
  });

  it('stops a late playback start while its video remains outside the viewport', async () => {
    const { container } = render(<VideoFrame media={videoMedia} hasCaption={false} />);
    showVideo();
    const video = container.querySelector('video')!;
    act(() => {
      notifyVisibility(
        [createVisibilityEntry({ target: video, isIntersecting: false })],
        {} as IntersectionObserver,
      );
    });

    await act(async () => {
      await video.play();
    });

    expect(video.paused).toBe(true);
  });

  it('pauses a muted preview on window blur and resumes it at the same position on focus', () => {
    const { container } = render(<VideoFrame media={videoMedia} hasCaption={false} />);
    showVideo();
    const video = container.querySelector('video')!;
    video.currentTime = 7;

    vi.mocked(document.hasFocus).mockReturnValue(false);
    fireEvent(window, new Event('blur'));
    expect(video.paused).toBe(true);

    vi.mocked(document.hasFocus).mockReturnValue(true);
    fireEvent(window, new Event('focus'));
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(7);
  });

  it('pauses muted previews while a round message owns audible playback', async () => {
    const { container } = render(
      <div>
        <VideoFrame media={videoMedia} hasCaption={false} />
        <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />
      </div>,
    );
    showVideo();
    const preview = container.querySelector('video')!;

    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});
    expect(preview.paused).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Pause video message' }));
    expect(preview.paused).toBe(false);
  });

  it('pauses a muted preview while the document is hidden and resumes it when visible', () => {
    const { container } = render(<VideoFrame media={videoMedia} hasCaption={false} />);
    showVideo();
    const video = container.querySelector('video')!;
    const hidden = vi.spyOn(document, 'hidden', 'get');

    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(video.paused).toBe(true);

    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(video.paused).toBe(false);
  });

  it('pauses chat video previews while a sticker overlay owns animation playback', () => {
    const { container } = render(<VideoFrame media={videoMedia} hasCaption={false} />);
    showVideo();
    const video = container.querySelector('video')!;
    let releasePlayback: (() => void) | undefined;

    act(() => {
      releasePlayback = reserveAnimationPlayback('preview');
    });
    expect(video.paused).toBe(true);

    act(() => releasePlayback?.());
    expect(video.paused).toBe(false);
  });

  it('allows explicit round playback when reduced motion disables its muted preview', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const { container } = render(
      <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />,
    );
    showVideo();
    const video = container.querySelector('video')!;
    expect(video.paused).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});

    expect(video.muted).toBe(false);
    expect(video.paused).toBe(false);
  });

  it('stops an existing audible clip when a round message starts', async () => {
    const { container } = render(
      <div>
        <audio src="/voice.ogg" />
        <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />
      </div>,
    );
    showVideo();
    const audio = container.querySelector('audio')!;
    await act(async () => {
      await audio.play();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});

    expect(audio.paused).toBe(true);
    expect(container.querySelector('video')!.paused).toBe(false);
  });

  it('keeps a muted round preview running when another clip starts with sound', async () => {
    const { container } = render(
      <div>
        <audio src="/voice.ogg" />
        <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />
      </div>,
    );
    showVideo();
    await act(async () => {});
    const video = container.querySelector('video')!;
    const audio = container.querySelector('audio')!;

    await act(async () => {
      await audio.play();
    });

    expect(video.muted).toBe(true);
    expect(video.paused).toBe(false);
    expect(audio.paused).toBe(false);
  });

  it('opens an ordinary video in the viewer without enabling sound in its preview', async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <VideoFrame media={videoMedia} hasCaption onOpen={onOpen} messageId="video-1" />,
    );
    showVideo();
    await act(async () => {});
    const video = container.querySelector('video')!;

    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));

    expect(onOpen).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    expect(video.paused).toBe(true);
  });

  it('restarts a round preview with sound and preserves position after pausing', async () => {
    const { container } = render(
      <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />,
    );
    showVideo();
    await act(async () => {});
    const video = container.querySelector('video')!;
    video.currentTime = 8;

    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});
    expect(video.currentTime).toBe(0);
    expect(video.muted).toBe(false);
    expect(video.loop).toBe(false);

    video.currentTime = 6;
    fireEvent.timeUpdate(video);
    expect(screen.getByText('0:14')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause video message' }));
    expect(video.paused).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});
    expect(video.currentTime).toBe(6);
  });

  it('returns to a muted loop after a round message finishes', async () => {
    const { container } = render(
      <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />,
    );
    showVideo();
    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});
    const video = container.querySelector('video')!;
    video.currentTime = 20;
    fireEvent.ended(video);
    await act(async () => {});

    expect(video.currentTime).toBe(0);
    expect(video.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Play video message' })).toBeTruthy();
    expect(screen.getByText('0:20')).toBeTruthy();
  });

  it('pauses audible round playback offscreen without resuming it automatically', async () => {
    const { container } = render(
      <VideoFrame media={{ ...videoMedia, isRound: true }} hasCaption={false} />,
    );
    showVideo();
    fireEvent.click(screen.getByRole('button', { name: 'Play video message' }));
    await act(async () => {});
    act(() => {
      notifyVisibility(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    showVideo();
    await act(async () => {});

    expect(container.querySelector('video')!.paused).toBe(true);
    expect(screen.getByRole('button', { name: 'Play video message' })).toBeTruthy();
  });
});
