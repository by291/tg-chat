import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import type { ReactElement } from 'react';
import styles from './RichEditorNodes.module.css';

interface MessageDateValue {
  timestamp: number;
  label?: string;
}

interface SerializedMessageDate extends SerializedLexicalNode {
  timestamp: number;
  label: string;
}

/** Preserve a localizable date as an atomic timestamp and readable label. */
export class MessageDateNode extends DecoratorNode<ReactElement> {
  __timestamp: number;
  __label: string;

  /** Initialize the timestamp and its chosen display text. */
  constructor(value: MessageDateValue, key?: NodeKey) {
    super(key);
    this.__timestamp = value.timestamp;
    this.__label = value.label || new Date(value.timestamp).toLocaleString();
  }

  /** Identify date snapshots. */
  static getType() {
    return 'message-date';
  }

  /** Preserve the timestamp, label, and immutable identity. */
  static clone(node: MessageDateNode) {
    return new MessageDateNode({ timestamp: node.__timestamp, label: node.__label }, node.__key);
  }

  /** Restore a date from a snapshot. */
  static importJSON(serialized: Parameters<typeof DecoratorNode.importJSON>[0]) {
    const timestamp = typeof serialized.timestamp === 'number' ? serialized.timestamp : 0;
    const label = typeof serialized.label === 'string' ? serialized.label : undefined;
    return $createMessageDateNode({ timestamp, label });
  }

  /** Import semantic timestamps from time or span elements. */
  static importDOM(): DOMConversionMap {
    const convert = (element: HTMLElement) => {
      const attribute = element.getAttribute('data-message-date');
      const timestamp = Number(attribute);
      if (attribute === null || !Number.isFinite(timestamp)) {
        return null;
      }

      return {
        conversion: () => ({
          node: $createMessageDateNode({ timestamp, label: element.textContent ?? undefined }),
        }),
        priority: 3 as const,
      };
    };
    return { time: convert, span: convert };
  }

  /** Preserve the readable label alongside the timestamp. */
  exportJSON(): SerializedMessageDate {
    return {
      ...super.exportJSON(),
      type: 'message-date',
      version: 1,
      timestamp: this.__timestamp,
      label: this.__label,
    };
  }

  /** Mount an inline host for the date decoration. */
  createDOM() {
    const element = document.createElement('span');
    element.className = styles.date;
    return element;
  }

  /** Retain the inline host between React updates. */
  updateDOM() {
    return false;
  }

  /** Export a machine-readable timestamp and human-readable label. */
  exportDOM() {
    const element = document.createElement('time');
    element.dataset.messageDate = String(this.__timestamp);
    element.dateTime = new Date(this.__timestamp).toISOString();
    element.textContent = this.__label;

    return { element };
  }

  /** Expose the displayed date to plain text extraction. */
  getTextContent() {
    return this.getLatest().__label;
  }

  /** Keep dates in their surrounding text line. */
  isInline() {
    return true;
  }

  /** Read the timestamp when reopening the date picker. */
  getTimestamp() {
    return this.getLatest().__timestamp;
  }

  /** Display the timestamp using the preserved label. */
  decorate() {
    return <time dateTime={new Date(this.__timestamp).toISOString()}>{this.__label}</time>;
  }
}

/** Create an atomic date within an editor update. */
export function $createMessageDateNode(value: MessageDateValue) {
  return $applyNodeReplacement(new MessageDateNode(value));
}
