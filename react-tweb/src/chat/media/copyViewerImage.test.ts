// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import { getPhotoMessages } from './photoGallery';
import { copyViewerImage } from './copyViewerImage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureClipboardImage() {
  let clipboardImage: Promise<Blob> | undefined;
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(content: Record<string, Promise<Blob>>) {
        clipboardImage = content['image/png'];
      }
    },
  );
  vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockResolvedValue(undefined) } });
  return () => clipboardImage;
}

function provideImageResponse(imageBlob: Blob) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(imageBlob),
    }),
  );
}

function provideDecodedImage(options: { decodeError?: Error } = {}) {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:viewer-image',
    revokeObjectURL,
  });
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 640;
      naturalHeight = 480;
      src = '';

      decode() {
        if (options.decodeError) {
          return Promise.reject(options.decodeError);
        }
        return Promise.resolve();
      }
    },
  );
  return revokeObjectURL;
}

describe('copying a viewer image', () => {
  const message = getPhotoMessages(createHistoryMessages())[0];

  it('writes image bytes rather than the image URL or message caption', async () => {
    const imageBlob = new Blob(['image content'], { type: 'image/png' });
    const onNotify = vi.fn();
    const getClipboardImage = captureClipboardImage();
    provideImageResponse(imageBlob);

    await copyViewerImage({ message, onNotify });

    expect(await getClipboardImage()).toBe(imageBlob);
    expect(onNotify).toHaveBeenCalledWith('Image copied to clipboard');
  });

  it.each([
    { format: 'JPEG', mimeType: 'image/jpeg' },
    { format: 'SVG', mimeType: 'image/svg+xml' },
  ])(
    'converts $format to a PNG clipboard payload at its original dimensions',
    async ({ mimeType }) => {
      const imageBlob = new Blob(['image content'], { type: mimeType });
      const pngBlob = new Blob(['png content'], { type: 'image/png' });
      const onNotify = vi.fn();
      const getClipboardImage = captureClipboardImage();
      provideImageResponse(imageBlob);
      const revokeObjectURL = provideDecodedImage();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
        imageType?: string,
      ) {
        expect(this.width).toBe(640);
        expect(this.height).toBe(480);
        expect(imageType).toBe('image/png');
        callback(pngBlob);
      });

      await copyViewerImage({ message, onNotify });

      expect(await getClipboardImage()).toBe(pngBlob);
      expect(onNotify).toHaveBeenCalledWith('Image copied to clipboard');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:viewer-image');
    },
  );

  it('releases temporary image URLs and reports decoding failures', async () => {
    const onNotify = vi.fn();
    captureClipboardImage();
    provideImageResponse(new Blob(['invalid image'], { type: 'image/svg+xml' }));
    const revokeObjectURL = provideDecodedImage({ decodeError: new Error('Invalid image') });

    await expect(copyViewerImage({ message, onNotify })).resolves.toBeUndefined();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:viewer-image');
    expect(onNotify).toHaveBeenCalledWith('Could not copy the image. Try downloading it instead.');
  });

  it('reports denied clipboard permission without escaping a rejected promise', async () => {
    const onNotify = vi.fn();
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', {
      clipboard: { write: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    provideImageResponse(new Blob([], { type: 'image/png' }));

    await expect(copyViewerImage({ message, onNotify })).resolves.toBeUndefined();

    expect(onNotify).toHaveBeenCalledWith('Could not copy the image. Try downloading it instead.');
  });

  it('reports an image download failure even when the clipboard accepts the request', async () => {
    const onNotify = vi.fn();
    captureClipboardImage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));

    await expect(copyViewerImage({ message, onNotify })).resolves.toBeUndefined();

    expect(onNotify).toHaveBeenCalledWith('Could not copy the image. Try downloading it instead.');
  });

  it('reports unsupported clipboard APIs without trying to fetch the image', async () => {
    const onNotify = vi.fn();
    const fetchImage = vi.fn();
    vi.stubGlobal('ClipboardItem', undefined);
    vi.stubGlobal('fetch', fetchImage);

    await copyViewerImage({ message, onNotify });

    expect(fetchImage).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith('This browser cannot copy images to the clipboard.');
  });
});
