// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { ViewerVideo } from './ViewerVideo';
import { animateViewerPhoto } from './mediaViewerTransition';

const videoMessage = {
  ...createInitialState().messages[0],
  id: 'viewer-video',
  attachment: undefined,
  media: {
    kind: 'video' as const,
    url: '/movie.mp4',
    poster: '/poster.png',
    width: 1280,
    height: 720,
    duration: 90,
  },
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('video viewer transitions', () => {
  it('uses a video-only thumbnail as the origin of the zoom transition', () => {
    const thumbnail = document.createElement('button');
    const preview = document.createElement('video');
    thumbnail.append(preview);
    preview.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: 500,
        y: 300,
        width: 320,
        height: 180,
      });
    const frame = document.createElement('div');
    frame.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: 100,
        y: 100,
        width: 640,
        height: 360,
      });
    frame.animate = (keyframes) => {
      Object.assign(frame.style, (keyframes as Keyframe[])[0]);
      return { cancel: () => {} } as Animation;
    };

    animateViewerPhoto({
      image: frame,
      source: thumbnail,
      isOpening: true,
      shouldReduceMotion: false,
    });
    expect(frame.style.transform).toBe('translate(240px, 110px) scale(0.5)');
  });

  it('keeps the poster available while the full video loads', () => {
    const view = render(<ViewerVideo message={videoMessage} isOpen activeIndex={0} />);
    const video = view.container.querySelector('video')!;
    expect(video.poster).toContain('/poster.png');
    expect(video.src).toContain('/movie.mp4');
    view.rerender(<ViewerVideo message={videoMessage} isOpen={false} activeIndex={0} />);
    expect(video.isConnected).toBe(true);
    expect(video.poster).toContain('/poster.png');
  });
});
