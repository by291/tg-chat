import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getEditor,
  $insertNodes,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';
import {
  splitEmojiText,
  type EmojiText,
  type CustomEmojiEntity,
} from '@/features/emoji/customEmojiEntities';
import { findCustomEmoji } from '@/features/emoji/customEmojiCatalog';
import { CustomEmojiNode, $createCustomEmojiNode } from './CustomEmojiNode';
import { $exportRichEditorHtml, parseRichEditorHtml } from './richEditorHtml';

// prettier-ignore
const PLAIN_NODE_TYPES = new Set([
  'root',
  'paragraph',
  'linebreak',
  'custom-emoji',
]);

interface EditorText extends EmojiText {
  customEmoji: CustomEmojiEntity[];
}

function createTextNodes(text: string) {
  const nodes: LexicalNode[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      nodes.push($createLineBreakNode());
    }
    if (line) {
      nodes.push($createTextNode(line));
    }
  }
  return nodes;
}

/** Restore domain text and emoji ranges without persisting Lexical's implementation format. */
export function $replaceEmojiEditor(value: EmojiText) {
  const root = $getRoot();
  root.clear();
  if (value.richText) {
    const document = parseRichEditorHtml(value.richText);
    const nodes = $generateNodesFromDOM($getEditor(), document);
    if (nodes.length > 0) {
      root.select();
      $insertNodes(nodes);
      return;
    }
  }
  const paragraph = $createParagraphNode();
  for (const part of splitEmojiText(value)) {
    const emoji = part.documentId ? findCustomEmoji(part.documentId) : undefined;
    if (emoji) {
      paragraph.append($createCustomEmojiNode({ documentId: emoji.id, text: part.text }));
    } else {
      paragraph.append(...createTextNodes(part.text));
    }
  }
  root.append(paragraph);
}

function collectCustomEmoji(options: {
  node: LexicalNode;
  offset: number;
  entities: CustomEmojiEntity[];
}) {
  const { node, offset, entities } = options;
  if (node instanceof CustomEmojiNode) {
    entities.push({
      documentId: node.getDocumentId(),
      offset,
      length: node.getTextContent().length,
    });
  }
  if (!$isElementNode(node)) {
    return;
  }

  // Lists and tables own their text separators. Locate children within that representation
  // instead of inventing a second set of newline/tab rules and corrupting emoji offsets.
  const text = node.getTextContent();
  let cursor = 0;
  for (const child of node.getChildren()) {
    const childText = child.getTextContent();
    const childOffset = text.indexOf(childText, cursor);
    if (childOffset < 0) {
      continue;
    }
    collectCustomEmoji({
      node: child,
      offset: offset + childOffset,
      entities,
    });
    cursor = childOffset + childText.length;
  }
}

function hasRichFormatting(node: LexicalNode): boolean {
  if ($isTextNode(node)) {
    return node.getFormat() !== 0;
  }
  const isPlainNode = PLAIN_NODE_TYPES.has(node.getType());
  if (!isPlainNode) {
    return true;
  }
  if ($isElementNode(node)) {
    return node.getChildren().some(hasRichFormatting);
  }
  return false;
}

/** Read offsets from the editor tree, including line breaks and atomic emoji fallbacks. */
export function $readEmojiEditor(): EditorText {
  const root = $getRoot();
  const isRichText = hasRichFormatting(root);
  const blocks = isRichText ? [root] : root.getChildren();
  const value: EditorText = { text: '', customEmoji: [] };
  for (const [index, block] of blocks.entries()) {
    // Lexical separates paragraphs with two newlines; chat paragraphs occupy one visual line.
    // Keep complex rich blocks in Lexical's representation so list/table emoji offsets stay valid.
    if (index > 0) {
      value.text += '\n';
    }
    collectCustomEmoji({
      node: block,
      offset: value.text.length,
      entities: value.customEmoji,
    });
    value.text += block.getTextContent();
  }
  if (isRichText) {
    value.richText = $exportRichEditorHtml();
  }
  return value;
}
