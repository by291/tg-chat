// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notifyVisibility = callback;
      }
      observe() {}
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function showVideo() {
  act(() => {
    notifyVisibility(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

describe('video message playback', () => {
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

  it('restarts the round preview with sound, then pauses and resumes at the same position', async () => {
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
