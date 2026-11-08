import type { Message } from '@/domain/messages/message';

interface DownloadableFile {
  name: string;
  url: string;
}

function getMediaFileName(options: { url: string; fallback: string }) {
  const mediaUrl = new URL(options.url, window.location.href);
  const fileName = mediaUrl.pathname.split('/').at(-1);
  return fileName ? decodeURIComponent(fileName) : options.fallback;
}

/** Resolve downloadable media without treating link previews as attachments. */
export function getMessageDownloads(message: Message): DownloadableFile[] {
  if (message.attachment) {
    return [message.attachment];
  }
  const media = message.media;
  if (!media) {
    return [];
  }
  if (media.kind === 'album') {
    return media.photos;
  }
  if (media.kind === 'document') {
    return [media];
  }
  if (media.kind === 'video' || media.kind === 'voice') {
    return [{ name: getMediaFileName({ url: media.url, fallback: message.id }), url: media.url }];
  }
  return [];
}

/** Download each selected local attachment using its existing browser URL. */
export function downloadMessageMedia(messages: Message[]) {
  const files = messages.flatMap(getMessageDownloads);
  for (const file of files) {
    const anchor = document.createElement('a');
    anchor.href = file.url;
    anchor.download = file.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
}
