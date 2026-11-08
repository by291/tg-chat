const animationRequests = new Map<string, Promise<unknown>>();

async function decodeSticker(source: string): Promise<unknown> {
  const response = await fetch(source);
  if (!response.ok || !response.body) {
    throw new Error('Could not load this sticker.');
  }

  // TGS is gzip-compressed Lottie JSON, so the original asset can stay compressed on disk.
  const animationStream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(animationStream).json();
}

/** Share decoded TGS requests while allowing failed downloads to be retried. */
export function loadStickerAnimation(source: string): Promise<unknown> {
  const existingRequest = animationRequests.get(source);
  if (existingRequest) {
    return existingRequest;
  }

  const request = decodeSticker(source).catch((error: unknown) => {
    animationRequests.delete(source);
    throw error;
  });
  animationRequests.set(source, request);
  return request;
}
