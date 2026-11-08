import { QuoteNode } from '@lexical/rich-text';
import {
  $applyNodeReplacement,
  $getState,
  $setState,
  createState,
  type EditorConfig,
  type LexicalEditor,
} from 'lexical';

const quoteCollapsedState = createState('isCollapsed', {
  parse: (value) => value === true,
});

function setCollapsedAttribute(element: HTMLElement, options: { isCollapsed: boolean }) {
  if (options.isCollapsed) {
    element.dataset.collapsed = 'true';
    return;
  }
  delete element.dataset.collapsed;
}

/** Preserve the sender's collapsed presentation choice while keeping the quote editable. */
export class CollapsibleQuoteNode extends QuoteNode {
  /** Extend standard quote editing with portable collapse metadata. */
  $config() {
    return this.config('collapsible-quote', {
      extends: QuoteNode,
      stateConfigs: [{ flat: true, stateConfig: quoteCollapsedState }],
      importDOM: {
        blockquote: (element) => ({
          conversion: () => ({
            node: $createCollapsibleQuoteNode({
              isCollapsed: element.getAttribute('data-collapsed') === 'true',
            }),
          }),
          priority: 1,
        }),
      },
    });
  }

  /** Read whether recipients should initially see a collapsed quote. */
  isCollapsed() {
    return $getState(this, quoteCollapsedState);
  }

  /** Change the presentation metadata without hiding editable text. */
  setCollapsed(options: { isCollapsed: boolean }) {
    return $setState(this, quoteCollapsedState, options.isCollapsed);
  }

  /** Retain the standard quote host and mark its outgoing presentation. */
  createDOM(config: EditorConfig) {
    const element = super.createDOM(config);
    setCollapsedAttribute(element, { isCollapsed: this.isCollapsed() });
    return element;
  }

  /** Update metadata without replacing the contenteditable host. */
  updateDOM(_previousQuote: this, element: HTMLElement) {
    setCollapsedAttribute(element, { isCollapsed: this.isCollapsed() });
    return false;
  }

  /** Export collapse metadata for clipboard, drafts, and sent messages. */
  exportDOM(editor: LexicalEditor) {
    const output = super.exportDOM(editor);
    if (output.element instanceof HTMLElement) {
      setCollapsedAttribute(output.element, { isCollapsed: this.isCollapsed() });
    }
    return output;
  }
}

/** Create a quote with an explicit initial presentation choice. */
export function $createCollapsibleQuoteNode(options: { isCollapsed: boolean }) {
  return $applyNodeReplacement(new CollapsibleQuoteNode()).setCollapsed(options);
}
