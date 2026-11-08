import policy from '../../../../../contracts/message-policy.json';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { sanitizeRichText } from '@/domain/messages/richText';
import { findCustomEmoji } from '@/features/emoji/customEmojiCatalog';

export interface MessageContent {
  schema_version: number;
  text: string;
  rich_text: string | null;
  custom_emoji: Array<{
    document_id: string;
    offset: number;
    length: number;
  }>;
}

const BLOCKS = new Set(policy.blocks);

function appendBoundary(content: MessageContent) {
  if (content.text && !content.text.endsWith('\n') && !content.text.endsWith('\t')) {
    content.text += '\n';
  }
}

function collectChildren(element: Element, content: MessageContent) {
  // Formula rendering uses the attribute, independently of an untrusted child text node.
  const formula = element.getAttribute('data-math');
  if (formula !== null) {
    content.text += formula;
    return;
  }
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      content.text += child.textContent ?? '';
    } else if (child instanceof Element) {
      collectText(child, content);
    }
  }
}

function collectText(element: Element, content: MessageContent) {
  const name = element.localName;
  const isBlock = BLOCKS.has(name);
  if (isBlock) {
    appendBoundary(content);
  }
  if (name === 'br') {
    content.text += '\n';
  }
  const start = content.text.length;
  collectChildren(element, content);
  const documentId = element.getAttribute('data-custom-emoji');
  if (documentId) {
    content.custom_emoji.push({
      document_id: documentId,
      offset: start,
      length: content.text.length - start,
    });
  }
  if (name === 'td' || name === 'th') {
    content.text = content.text.replace(/\n+$/, '');
    content.text += '\t';
  }
  if (name === 'tr') {
    content.text = content.text.replace(/\t+$/, '');
  }
  if (isBlock) {
    appendBoundary(content);
  }
}

function validateEntities(content: MessageContent) {
  if (content.custom_emoji.length > policy.max_emoji) {
    throw new Error('Too many custom emoji.');
  }
  let previousEnd = 0;
  for (const entity of content.custom_emoji) {
    const asset = findCustomEmoji(entity.document_id);
    const end = entity.offset + entity.length;
    const fallback = content.text.slice(entity.offset, end);
    const isValid =
      asset?.emoji === fallback && entity.offset >= previousEnd && end > entity.offset;
    if (!isValid) {
      throw new Error('A custom emoji does not match its message text.');
    }
    previousEnd = end;
  }
}

/** Derive the shared wire representation without relying on Lexical's internal block separators. */
export function canonicalMessageContent(value: EmojiText): MessageContent {
  const richText = value.richText ? sanitizeRichText(value.richText) : null;
  const content: MessageContent = {
    schema_version: policy.schema_version,
    text: richText ? '' : value.text,
    rich_text: richText,
    custom_emoji: [],
  };
  if (richText) {
    const document = new DOMParser().parseFromString(richText, 'text/html');
    collectText(document.body, content);
    content.text = content.text.replace(/\n+$/, '');
  } else {
    content.custom_emoji = (value.customEmoji ?? []).map((entity) => ({
      document_id: entity.documentId,
      offset: entity.offset,
      length: entity.length,
    }));
  }
  if (!content.text.trim() || content.text.length > policy.max_text_units) {
    throw new Error('Messages require text and support at most 4,096 UTF-16 characters.');
  }
  validateEntities(content);

  return content;
}
