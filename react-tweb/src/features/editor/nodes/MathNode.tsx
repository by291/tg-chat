import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import { useMemo, type ReactElement } from 'react';
import { renderFormulaHtml } from '@/lib/math/renderFormula';
import 'katex/dist/katex.min.css';
import styles from './RichEditorNodes.module.css';

interface MathValue {
  source: string;
  isBlock: boolean;
}

interface SerializedMathNode extends SerializedLexicalNode, MathValue {}

/** Render trusted KaTeX output with raw LaTeX as an accessible fallback. */
export function MathPreview({ source, isBlock }: MathValue) {
  const markup = useMemo(() => renderFormulaHtml({ source, isBlock }), [source, isBlock]);

  return <span aria-label={source} dangerouslySetInnerHTML={{ __html: markup }} />;
}

/** Store a formula atomically while preserving its editable source. */
export class MathNode extends DecoratorNode<ReactElement> {
  __source: string;
  __isBlock: boolean;

  /** Initialize immutable formula content. */
  constructor(value: MathValue, key?: NodeKey) {
    super(key);
    this.__source = value.source;
    this.__isBlock = value.isBlock;
  }

  /** Identify formula snapshots. */
  static getType() {
    return 'math';
  }

  /** Preserve formula source and identity across updates. */
  static clone(node: MathNode) {
    return new MathNode({ source: node.__source, isBlock: node.__isBlock }, node.__key);
  }

  /** Restore a formula from an editor snapshot. */
  static importJSON(serialized: Parameters<typeof DecoratorNode.importJSON>[0]) {
    const source = typeof serialized.source === 'string' ? serialized.source : '';
    const isBlock = serialized.isBlock === true;
    return $createMathNode({ source, isBlock });
  }

  /** Import formula source instead of generated presentation markup. */
  static importDOM(): DOMConversionMap {
    const convert = (element: HTMLElement) => {
      const source = element.getAttribute('data-math');
      if (source === null) {
        return null;
      }
      const isBlock = element.getAttribute('data-math-display') === 'block';
      return {
        conversion: () => ({ node: $createMathNode({ source, isBlock }) }),
        priority: 3 as const,
      };
    };
    return { span: convert, div: convert };
  }

  /** Preserve source and layout in snapshots. */
  exportJSON(): SerializedMathNode {
    return {
      ...super.exportJSON(),
      type: 'math',
      version: 1,
      source: this.__source,
      isBlock: this.__isBlock,
    };
  }

  /** Create a host appropriate to the formula's layout. */
  createDOM() {
    const element = document.createElement(this.__isBlock ? 'div' : 'span');
    element.className = styles.math;
    return element;
  }

  /** Recreate the host when changing between inline and block layouts. */
  updateDOM(previous: MathNode) {
    return previous.__isBlock !== this.__isBlock;
  }

  /** Export semantic source for safe round trips. */
  exportDOM() {
    // Portable message HTML uses one allowed host; the layout attribute preserves block intent.
    const element = document.createElement('span');
    element.dataset.math = this.__source;
    element.dataset.mathDisplay = this.__isBlock ? 'block' : 'inline';
    element.textContent = this.__source;
    return { element };
  }

  /** Expose source text for searching and plain text copying. */
  getTextContent() {
    return this.getLatest().__source;
  }

  /** Respect the formula's chosen placement. */
  isInline() {
    return !this.__isBlock;
  }

  /** Read the original formula for editing. */
  getValue(): MathValue {
    const current = this.getLatest();
    return { source: current.__source, isBlock: current.__isBlock };
  }

  /** Display the formula in the editable document. */
  decorate() {
    return <MathPreview source={this.__source} isBlock={this.__isBlock} />;
  }
}

/** Create a formula within an editor update. */
export function $createMathNode(value: MathValue) {
  return $applyNodeReplacement(new MathNode(value));
}
