import { getMediaGeometry } from '@/features/media/mediaGeometry';
import { findSticker, STICKER_MESSAGE_SIZE } from '@/features/stickers/stickerCatalog';
import type { HistoryRow } from './historyRows';
import { HISTORY_DATE_ROW_HEIGHT } from './historyDates';

const DEFAULT_VIEWPORT_WIDTH = 696;
const MAX_BUBBLE_WIDTH = 480;
const BUBBLE_WIDTH_RATIO = 0.84;
const HORIZONTAL_GUTTER = 40;
const TEXT_LINE_HEIGHT = 21;
const AVERAGE_GLYPH_WIDTH = 8;
const SERVICE_ROW_HEIGHT = 42;
const UNREAD_ROW_HEIGHT = 38;
const BASE_MESSAGE_HEIGHT = 28;
const MESSAGE_GAP = 2;
const GROUP_END_GAP = 6;
const AUTHOR_LINE_HEIGHT = 22;
const REPLY_HEIGHT = 48;
const REACTION_HEIGHT = 36;
const STICKER_HEIGHT = 112;
const ROUND_VIDEO_SIZE = 240;
const ALBUM_HEIGHT_RATIO = 0.8;
const LINK_WITH_IMAGE_HEIGHT = 260;
const LINK_TEXT_HEIGHT = 100;
const POLL_HEADER_HEIGHT = 100;
const POLL_OPTION_HEIGHT = 48;
const COMPACT_MEDIA_HEIGHT = 76;

function estimateTextHeight(text: string, availableWidth: number) {
  const charactersPerLine = Math.max(1, availableWidth / AVERAGE_GLYPH_WIDTH);
  const paragraphs = text.split('\n');
  let lineCount = 0;

  for (const paragraph of paragraphs) {
    lineCount += Math.max(1, Math.ceil(paragraph.length / charactersPerLine));
  }

  return lineCount * TEXT_LINE_HEIGHT;
}

/** Estimate each row from the same metadata used by its first painted media frame. */
export function estimateHistoryRow(row: HistoryRow, viewportWidth = DEFAULT_VIEWPORT_WIDTH) {
  if (row.kind === 'date') {
    return HISTORY_DATE_ROW_HEIGHT;
  }
  if (row.kind === 'unread') {
    return UNREAD_ROW_HEIGHT;
  }

  const message = row.message;
  if (message.isService) {
    return SERVICE_ROW_HEIGHT;
  }

  const bubbleWidth = Math.min(MAX_BUBBLE_WIDTH, viewportWidth * BUBBLE_WIDTH_RATIO);
  const availableWidth = Math.max(1, bubbleWidth - HORIZONTAL_GUTTER);
  let height = BASE_MESSAGE_HEIGHT;
  height += row.isGroupEnd ? GROUP_END_GAP : MESSAGE_GAP;
  height += row.isGroupStart ? AUTHOR_LINE_HEIGHT : 0;
  height += message.replyToId ? REPLY_HEIGHT : 0;
  height += message.reactions.length ? REACTION_HEIGHT : 0;
  height += message.text ? estimateTextHeight(message.text, availableWidth) : 0;
  if (message.sticker) {
    height += findSticker(message.sticker) ? STICKER_MESSAGE_SIZE : STICKER_HEIGHT;
  }

  const media = message.media;
  const photo = message.attachment;
  if (photo || media?.kind === 'video') {
    const dimensions = photo || media;
    if (dimensions && 'width' in dimensions) {
      const geometry = getMediaGeometry({
        width: dimensions.width,
        height: dimensions.height,
        hasCaption: Boolean(message.text),
        isVideo: media?.kind === 'video',
        availableWidth,
      });
      height += media?.kind === 'video' && media.isRound ? ROUND_VIDEO_SIZE : geometry.height;
    }
    return height;
  }

  switch (media?.kind) {
    case 'album':
      return height + availableWidth * ALBUM_HEIGHT_RATIO;
    case 'link':
      return height + (media.image ? LINK_WITH_IMAGE_HEIGHT : LINK_TEXT_HEIGHT);
    case 'checklist':
      return height + POLL_HEADER_HEIGHT + media.items.length * POLL_OPTION_HEIGHT;
    case 'poll':
      return height + POLL_HEADER_HEIGHT + media.options.length * POLL_OPTION_HEIGHT;
    case 'voice':
    case 'document':
    case 'contact':
      return height + COMPACT_MEDIA_HEIGHT;
    default:
      return height;
  }
}
