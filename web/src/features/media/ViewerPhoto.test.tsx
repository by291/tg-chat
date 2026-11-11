// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import { ViewerPhoto } from './ViewerPhoto';
import { rememberPhotoSource } from './mediaViewerTransition';
import messageStyles from '@/features/chat/messages/content/MessageBody.module.css?inline';

const photoMessage = {
  ...createInitialState().messages[0],
  id: 'viewer-photo',
  attachment: {
    url: '/photo.png',
    name: 'Landscape',
    width: 1200,
    height: 800,
  },
};

let mediaStyles: HTMLStyleElement;

beforeAll(() => {
  mediaStyles = document.createElement('style');
  mediaStyles.textContent = messageStyles;
  document.head.append(mediaStyles);
});

afterAll(() => mediaStyles.remove());

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    const isThumbnail = Boolean(this.closest('[data-photo-id]'));
    return DOMRect.fromRect(
      isThumbnail
        ? {
            x: 900,
            y: 400,
            width: 420,
            height: 280,
          }
        : {
            x: 100,
            y: 80,
            width: 900,
            height: 600,
          },
    );
  });
  // Emulate the visible first frame and cancellation, not the browser's timing engine.
  HTMLImageElement.prototype.animate = function (frames) {
    const firstFrame = (frames as Keyframe[])[0];
    Object.assign(this.style, firstFrame);
    return {
      cancel: () => {
        this.style.transform = '';
        this.style.clipPath = '';
        this.style.opacity = '';
      },
    } as Animation;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('photo viewer transitions', () => {
  it('renews an expired private preview in the open viewer', async () => {
    const renewedUrl = '/renewed-photo.png';
    const authorize = vi.fn(async () => renewedUrl);
    const message = { ...photoMessage, renewPreviewUrl: authorize };
    render(<ViewerPhoto message={message} isOpen activeIndex={0} />);

    const image = screen.getByAltText('Landscape');
    expect(image.getAttribute('src')).toBe('/photo.png');
    fireEvent.error(image);

    await waitFor(() => expect(image.getAttribute('src')).toBe(renewedUrl));
  });

  it('returns to the clicked copy when the same photo is also visible in history', () => {
    const historySource = document.createElement('button');
    const sharedSource = document.createElement('button');

    for (const source of [historySource, sharedSource]) {
      source.dataset.photoId = photoMessage.id;
      source.append(document.createElement('img'));
      source.getBoundingClientRect = () =>
        DOMRect.fromRect({
          y: 400,
          width: 420,
          height: 280,
        });
      document.body.append(source);
    }

    rememberPhotoSource(photoMessage.id, sharedSource);
    const view = render(<ViewerPhoto message={photoMessage} isOpen activeIndex={0} />);
    expect(sharedSource.getAttribute('data-viewer-source')).toBe('true');
    expect(historySource.hasAttribute('data-viewer-source')).toBe(false);
    view.rerender(<ViewerPhoto message={photoMessage} isOpen={false} activeIndex={0} />);
    expect(sharedSource.getAttribute('data-viewer-source')).toBe('true');
    view.unmount();
    historySource.remove();
    sharedSource.remove();
  });

  it('starts a rapid close at the currently displayed scale and position', () => {
    const view = render(<ViewerPhoto message={photoMessage} isOpen activeIndex={0} />);
    const image = screen.getByAltText('Landscape');
    const currentTransform = 'translate(120px, 80px) scale(0.6)';
    image.style.transform = currentTransform;
    image.style.clipPath = 'inset(0px round 12px)';

    view.rerender(<ViewerPhoto message={photoMessage} isOpen={false} activeIndex={0} />);
    expect(image.style.transform).toBe(currentTransform);
    expect(image.style.clipPath).toBe('inset(0px round 12px)');
  });

  it('keeps the original thumbnail visible while the viewer opens and closes', () => {
    const source = document.createElement('button');
    source.dataset.photoId = photoMessage.id;
    source.append(document.createElement('img'));
    source.getBoundingClientRect = () =>
      DOMRect.fromRect({
        y: 400,
        width: 420,
        height: 280,
      });
    document.body.append(source);
    const view = render(<ViewerPhoto message={photoMessage} isOpen activeIndex={0} />);
    expect(source.getAttribute('data-viewer-source')).toBe('true');
    expect(getComputedStyle(source).visibility).toBe('visible');
    view.rerender(<ViewerPhoto message={photoMessage} isOpen={false} activeIndex={0} />);
    expect(getComputedStyle(source).visibility).toBe('visible');
    view.unmount();
    expect(source.hasAttribute('data-viewer-source')).toBe(false);
    source.remove();
  });
});
