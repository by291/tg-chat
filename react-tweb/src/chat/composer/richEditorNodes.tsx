import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  $applyNodeReplacement,
  ElementNode,
  type DOMConversionMap,
  type SerializedElementNode,
} from 'lexical';
import { CollapsibleQuoteNode, $createCollapsibleQuoteNode } from './CollapsibleQuoteNode';
import styles from './RichEditorNodes.module.css';

export { MathNode, $createMathNode } from './MathNode';
export { MessageDateNode, $createMessageDateNode } from './MessageDateNode';
import { MathNode } from './MathNode';
import { MessageDateNode } from './MessageDateNode';

/** Wrap editable inline content in a semantic spoiler span. */
export class SpoilerNode extends ElementNode {
  /** Identify spoiler snapshots. */
  static getType() {
    return 'spoiler';
  }

  /** Preserve immutable node identity. */
  static clone(node: SpoilerNode) {
    return new SpoilerNode(node.__key);
  }

  /** Restore the inherited element properties. */
  static importJSON(serialized: SerializedElementNode) {
    return $createSpoilerNode().updateFromJSON(serialized);
  }

  /** Import only spans explicitly marked as spoilers. */
  static importDOM(): DOMConversionMap {
    return {
      span: (element) => {
        if (element.getAttribute('data-spoiler') !== 'true') {
          return null;
        }
        return { conversion: () => ({ node: $createSpoilerNode() }), priority: 2 };
      },
    };
  }

  /** Keep spoilers visible while composing. */
  createDOM() {
    const element = document.createElement('span');
    element.dataset.spoiler = 'true';
    element.className = styles.spoiler;
    return element;
  }

  /** Retain the existing inline host. */
  updateDOM() {
    return false;
  }

  /** Export portable spoiler semantics without editor styling. */
  exportDOM() {
    const element = document.createElement('span');
    element.dataset.spoiler = 'true';
    return { element };
  }

  /** Let spoilers participate in their surrounding paragraph. */
  isInline() {
    return true;
  }
}

/** Hold an editable summary and collapsible body in one semantic block. */
export class DetailsNode extends ElementNode {
  /** Identify collapsible block snapshots. */
  static getType() {
    return 'details';
  }

  /** Preserve immutable node identity. */
  static clone(node: DetailsNode) {
    return new DetailsNode(node.__key);
  }

  /** Restore inherited block properties. */
  static importJSON(serialized: SerializedElementNode) {
    return $createDetailsNode().updateFromJSON(serialized);
  }

  /** Read standard HTML disclosure blocks. */
  static importDOM(): DOMConversionMap {
    return { details: () => ({ conversion: () => ({ node: $createDetailsNode() }), priority: 1 }) };
  }

  /** Show the body initially so newly inserted content can be edited. */
  createDOM() {
    const element = document.createElement('details');
    element.open = true;
    element.className = styles.details;
    return element;
  }

  /** Leave the user's open or closed state intact during typing. */
  updateDOM() {
    return false;
  }

  /** Export a native expandable disclosure. */
  exportDOM() {
    return { element: document.createElement('details') };
  }
}

/** Keep the disclosure title editable independently of its body. */
export class SummaryNode extends ElementNode {
  /** Identify disclosure title snapshots. */
  static getType() {
    return 'summary';
  }

  /** Preserve immutable node identity. */
  static clone(node: SummaryNode) {
    return new SummaryNode(node.__key);
  }

  /** Restore inherited title properties. */
  static importJSON(serialized: SerializedElementNode) {
    return $createSummaryNode().updateFromJSON(serialized);
  }

  /** Read native disclosure titles. */
  static importDOM(): DOMConversionMap {
    return { summary: () => ({ conversion: () => ({ node: $createSummaryNode() }), priority: 1 }) };
  }

  /** Render an editable native disclosure title. */
  createDOM() {
    return document.createElement('summary');
  }

  /** Retain the native title element across text updates. */
  updateDOM() {
    return false;
  }

  /** Export standard disclosure title markup. */
  exportDOM() {
    return { element: document.createElement('summary') };
  }
}

/** Create an inline spoiler container within an editor update. */
export function $createSpoilerNode() {
  return $applyNodeReplacement(new SpoilerNode());
}

/** Create a disclosure block within an editor update. */
export function $createDetailsNode() {
  return $applyNodeReplacement(new DetailsNode());
}

/** Create a disclosure title within an editor update. */
export function $createSummaryNode() {
  return $applyNodeReplacement(new SummaryNode());
}

export const RICH_EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  CollapsibleQuoteNode,
  {
    replace: QuoteNode,
    with: () => $createCollapsibleQuoteNode({ isCollapsed: false }),
    withKlass: CollapsibleQuoteNode,
  },
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  HorizontalRuleNode,
  SpoilerNode,
  DetailsNode,
  SummaryNode,
  MathNode,
  MessageDateNode,
];
