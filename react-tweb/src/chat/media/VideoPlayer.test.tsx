// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { VideoPlayer } from './VideoPlayer';

const videoMedia = {
  kind: 'video' as const,
  url: '/movie.mp4',
  poster: '/poster.png',
  width: 1280,
  height: 720,
  duration: 90,
};

beforeEach(() => {
  // jsdom has no media decoder; preserve the browser's playback events and paused state.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, 'paused', {
      configurable: true,
      value: false,
    });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, 'paused', {
      configurable: true,
      value: true,
    });
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('viewer video playback', () => {
  it('ignores an obsolete autoplay rejection after a new playback attempt succeeds', async () => {
    let rejectFirstPlay: (reason: Error) => void = () => {};
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => {
      return new Promise<void>((_resolve, reject) => {
        rejectFirstPlay = reject;
      });
    });
    render(
      <StrictMode>
        <VideoPlayer media={videoMedia} isActive />
      </StrictMode>,
    );

    await act(async () => rejectFirstPlay(new Error('The play request was interrupted')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy();
  });

  it('hides inactive controls during playback and reveals them on movement or pause', () => {
    vi.useFakeTimers();
    render(<VideoPlayer media={videoMedia} isActive />);
    const player = screen.getByRole('group', { name: 'Video player' });
    const controls = screen.getByRole('group', { name: 'Video controls' });

    act(() => vi.advanceTimersByTime(3100));
    expect(controls.getAttribute('data-visible')).toBe('false');
    fireEvent.pointerMove(player);
    expect(controls.getAttribute('data-visible')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }));
    act(() => vi.advanceTimersByTime(3100));
    expect(controls.getAttribute('data-visible')).toBe('true');
  });

  it('keeps controls visible while a slider is being dragged', () => {
    vi.useFakeTimers();
    render(<VideoPlayer media={videoMedia} isActive />);
    const controls = screen.getByRole('group', { name: 'Video controls' });
    const seekControl = screen.getByRole('slider', { name: 'Seek video' });

    fireEvent.pointerDown(seekControl);
    act(() => vi.advanceTimersByTime(3100));
    expect(controls.getAttribute('data-visible')).toBe('true');
    fireEvent.pointerUp(document);
    act(() => vi.advanceTimersByTime(3100));
    expect(controls.getAttribute('data-visible')).toBe('false');
  });

  it('toggles playback with Space when the player itself has keyboard focus', () => {
    const view = render(<VideoPlayer media={videoMedia} isActive />);
    const player = screen.getByRole('group', { name: 'Video player' });
    const video = view.container.querySelector('video')!;

    fireEvent.keyDown(player, { key: ' ' });
    expect(video.paused).toBe(true);
    fireEvent.keyDown(player, { key: ' ' });
    expect(video.paused).toBe(false);
  });

  it('returns from fullscreen when the retained viewer closes', async () => {
    const view = render(<VideoPlayer media={videoMedia} isActive />);
    const player = screen.getByRole('group', { name: 'Video player' });
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    const previousExitFullscreen = document.exitFullscreen;
    document.exitFullscreen = async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    player.requestFullscreen = async () => {
      fullscreenElement = player;
      document.dispatchEvent(new Event('fullscreenchange'));
    };

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
      expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
      expect(document.fullscreenElement).toBe(player);
      view.rerender(<VideoPlayer media={videoMedia} isActive={false} />);
      expect(document.fullscreenElement).toBeNull();
    } finally {
      document.exitFullscreen = previousExitFullscreen;
      Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });

  it('plays on opening and pauses immediately while the closing viewer remains mounted', () => {
    const view = render(<VideoPlayer media={videoMedia} isActive />);
    const video = view.container.querySelector('video')!;
    expect(video.paused).toBe(false);
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy();

    view.rerender(<VideoPlayer media={videoMedia} isActive={false} />);
    expect(video.paused).toBe(true);
    expect(video.isConnected).toBe(true);
  });

  it('seeks the actual video and keeps arrow keys inside the seek control', () => {
    const onKeyDown = vi.fn();
    const view = render(
      <div onKeyDown={onKeyDown}>
        <VideoPlayer media={videoMedia} isActive />
      </div>,
    );
    const seekControl = screen.getByRole('slider', { name: 'Seek video' });
    fireEvent.change(seekControl, { target: { value: '45' } });
    expect(view.container.querySelector('video')!.currentTime).toBe(45);
    expect(screen.getByText('0:45 / 1:30')).toBeTruthy();

    fireEvent.keyDown(seekControl, { key: 'ArrowRight' });
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(seekControl, { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('changes the actual volume and restores sound after muting', () => {
    const view = render(<VideoPlayer media={videoMedia} isActive />);
    const video = view.container.querySelector('video')!;
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), {
      target: { value: '0.4' },
    });
    expect(video.volume).toBe(0.4);
    fireEvent.click(screen.getByRole('button', { name: 'Mute video' }));
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute video' }));
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.4);
  });

  it('keeps a usable play control after autoplay is denied', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('Not allowed'));
    render(<VideoPlayer media={videoMedia} isActive />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy());
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Video could not be played. Try playing it again.',
    );
  });
});
