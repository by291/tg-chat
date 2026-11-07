import {
  DecoratorNode,
  $applyNodeReplacement,
  type NodeKey,
  type SerializedLexicalNode,
  type DOMConversionMap,
  type DOMExportOutput,
} from 'lexical';
import type { ReactElement } from 'react';
import { CustomEmojiText } from '../emoji/CustomEmojiText';
import { findCustomEmoji } from '../emoji/customEmojiCatalog';

interface SerializedCustomEmoji extends SerializedLexicalNode {
  documentId: string;
  text: string;
}

/** Keep an animated emoji atomic while exposing its Unicode fallback to text operations. */
export class CustomEmojiNode extends DecoratorNode<ReactElement> {
  __documentId: string;
  __text: string;

  /** Create an immutable emoji reference for Lexical to own. */
  constructor(documentId: string, text: string, key?: NodeKey) {
    super(key);
    this.__documentId = documentId;
    this.__text = text;
  }

  /** Identify this node in editor snapshots. */
  static getType() {
    return 'custom-emoji';
  }

  /** Preserve document identity across immutable editor updates. */
  static clone(node: CustomEmojiNode) {
    return new CustomEmojiNode(node.__documentId, node.__text, node.__key);
  }

  /** Restore a node from a Lexical snapshot with validated string fields. */
  static importJSON(serialized: Parameters<typeof DecoratorNode.importJSON>[0]) {
    const documentId = typeof serialized.documentId === 'string' ? serialized.documentId : '';
    const text = typeof serialized.text === 'string' ? serialized.text : '';
    return $createCustomEmojiNode({ documentId, text });
  }

  /** Include the Telegram document reference in editor snapshots. */
  exportJSON(): SerializedCustomEmoji {
    return {
      ...super.exportJSON(),
      type: 'custom-emoji',
      version: 1,
      documentId: this.__documentId,
      text: this.__text,
    };
  }

  /** Restore supported custom emoji from copied or persisted semantic HTML. */
  static importDOM(): DOMConversionMap {
    return {
      span: (element) => {
        const documentId = element.getAttribute('data-custom-emoji');
        if (!documentId || !findCustomEmoji(documentId)) {
          return null;
        }
        return {
          priority: 4,
          conversion: () => ({
            node: $createCustomEmojiNode({ documentId, text: element.textContent ?? '' }),
          }),
        };
      },
    };
  }

  /** Keep the emoji reference and readable fallback when copying or saving rich content. */
  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.setAttribute('data-custom-emoji', this.getDocumentId());
    element.textContent = this.getTextContent();
    return { element };
  }

  /** Mount an inline noneditable host for the React animation. */
  createDOM() {
    const element = document.createElement('span');
    element.setAttribute('data-emoji-node', this.__documentId);
    element.style.display = 'inline';
    return element;
  }

  /** Keep the host stable while React updates its decoration. */
  updateDOM() {
    return false;
  }

  /** Participate in the surrounding text line rather than creating a block. */
  isInline() {
    return true;
  }

  /** Expose the Unicode fallback to copying and text extraction. */
  getTextContent() {
    return this.getLatest().__text;
  }

  /** Read the current immutable Telegram document reference. */
  getDocumentId() {
    return this.getLatest().__documentId;
  }

  /** Render the shared visibility-aware animation inside the editor. */
  decorate() {
    return (
      <CustomEmojiText
        text={this.__text}
        customEmoji={[
          {
            documentId: this.__documentId,
            offset: 0,
            length: this.__text.length,
          },
        ]}
      />
    );
  }
}

/** Create a registered inline node from a local custom emoji reference. */
export function $createCustomEmojiNode(value: { documentId: string; text: string }) {
  return $applyNodeReplacement(new CustomEmojiNode(value.documentId, value.text));
}
