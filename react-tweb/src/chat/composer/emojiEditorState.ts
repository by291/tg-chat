import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type LexicalNode,
} from 'lexical';
import { splitEmojiText, type EmojiText } from '../emoji/customEmojiEntities';
import { findCustomEmoji } from '../emoji/customEmojiCatalog';
import { CustomEmojiNode, $createCustomEmojiNode } from './CustomEmojiNode';

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

function appendNodeText(node: LexicalNode, value: Required<EmojiText>) {
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      appendNodeText(child, value);
    }
    return;
  }
  const text = node.getTextContent();
  if (node instanceof CustomEmojiNode) {
    value.customEmoji.push({
      documentId: node.getDocumentId(),
      offset: value.text.length,
      length: text.length,
    });
  }
  value.text += text;
}

/** Read offsets from the editor tree, including line breaks and atomic emoji fallbacks. */
export function $readEmojiEditor(): Required<EmojiText> {
  const value: Required<EmojiText> = { text: '', customEmoji: [] };
  for (const [index, paragraph] of $getRoot().getChildren().entries()) {
    if (index > 0) {
      value.text += '\n';
    }
    appendNodeText(paragraph, value);
  }
  return value;
}
