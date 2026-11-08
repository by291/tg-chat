import type { Message } from '@/domain/messages/message';

const CLIPBOARD_IMAGE_TYPE = 'image/png';

interface CopyViewerImageOptions {
  message: Message;
  onNotify: (message: string) => void;
}

/** Check whether this browser exposes its binary clipboard API. */
export function canCopyViewerImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

function encodeCanvasImage(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((imageBlob) => {
      if (!imageBlob) {
        reject(new Error('Could not encode the image for the clipboard.'));
        return;
      }
      resolve(imageBlob);
    }, CLIPBOARD_IMAGE_TYPE);
  });
}

async function loadClipboardImage(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Could not load the image for the clipboard.');
  }

  const imageBlob = await response.blob();
  if (imageBlob.type === CLIPBOARD_IMAGE_TYPE) {
    return imageBlob;
  }

  // The gallery's SVG images decode through HTMLImageElement in browsers that reject ImageBitmap.
  const imageUrl = URL.createObjectURL(imageBlob);

  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();

    // PNG is the interoperable clipboard format for every displayed image format.
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not prepare the image for the clipboard.');
    }

    context.drawImage(image, 0, 0);

    return await encodeCanvasImage(canvas);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/** Copy the displayed photo bytes and report browser, network, and permission failures. */
export async function copyViewerImage({ message, onNotify }: CopyViewerImageOptions) {
  if (!canCopyViewerImage()) {
    onNotify('This browser cannot copy images to the clipboard.');
    return;
  }
  if (!message.attachment) {
    onNotify('There is no image to copy.');
    return;
  }

  const imagePromise = loadClipboardImage(message.attachment.url);

  try {
    // Start the clipboard write within the click gesture; encoding resolves asynchronously.
    const clipboardItem = new ClipboardItem({ [CLIPBOARD_IMAGE_TYPE]: imagePromise });
    await Promise.all([navigator.clipboard.write([clipboardItem]), imagePromise]);
    onNotify('Image copied to clipboard');
  } catch {
    // A constructor rejection can occur before the clipboard starts consuming imagePromise.
    void imagePromise.catch(() => undefined);
    onNotify('Could not copy the image. Try downloading it instead.');
  }
}
