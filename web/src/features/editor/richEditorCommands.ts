import { $createCodeNode, $isCodeNode } from '@lexical/code';
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $setBlocksType } from '@lexical/selection';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isQuoteNode,
  type HeadingTagType,
} from '@lexical/rich-text';
import { $findMatchingParent, $insertNodeToNearestRoot, $unwrapNode } from '@lexical/utils';
import {
  $copyNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import {
  $createDetailsNode,
  $createSpoilerNode,
  $createSummaryNode,
  SpoilerNode,
} from './nodes/richEditorNodes';

import { CollapsibleQuoteNode } from './nodes/CollapsibleQuoteNode';

export type BlockFormat = 'paragraph' | 'quote' | 'code' | HeadingTagType;

/** Find the nearest selected ancestor with the requested semantic type. */
export function $findSelectedAncestor(type: string): LexicalNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }

  const anchor = selection.anchor.getNode();

  return $findMatchingParent(anchor, (node) => {
    return type === 'quote' ? $isQuoteNode(node) : node.getType() === type;
  });
}

/** Apply a paragraph-level format through Lexical's block conversion utility. */
export function $setComposerBlock(format: BlockFormat) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return;
  }
  if (format === 'paragraph') {
    $setBlocksType(selection, $createParagraphNode);
    return;
  }
  if (format === 'quote') {
    const isQuote = $findSelectedAncestor('quote') !== null;
    if (isQuote) {
      $setBlocksType(selection, $createParagraphNode);
    } else {
      $setBlocksType(selection, $createQuoteNode);
    }
    return;
  }
  if (format === 'code') {
    $setBlocksType(selection, () => $createCodeNode());
    return;
  }

  $setBlocksType(selection, () => $createHeadingNode(format));
}

function $isolateInlineChild(node: LexicalNode) {
  const parent = node.getParentOrThrow();
  const preceding = node.getPreviousSiblings();
  const following = node.getNextSiblings();
  if (preceding.length > 0) {
    const before = $copyNode(parent);
    parent.insertBefore(before);
    before.append(...preceding);
  }
  if (following.length > 0) {
    const after = $copyNode(parent);
    parent.insertAfter(after);
    after.append(...following);
  }

  return parent;
}

function $removeSelectedSpoiler(node: LexicalNode) {
  const spoiler = $findMatchingParent(node, (parent) => parent instanceof SpoilerNode);
  if (!(spoiler instanceof SpoilerNode)) {
    return;
  }

  // Split only inline ancestors so unselected text keeps both its marks and paragraph position.
  let current = node;

  while (current.getParent() !== spoiler) {
    current = $isolateInlineChild(current);
  }

  $isolateInlineChild(current);
  $unwrapNode(spoiler);
}

/** Toggle spoiler wrapping without changing unselected portions of a text node. */
export function $toggleComposerSpoiler() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return;
  }

  const selectedNodes = selection.extract();
  const leaves = selectedNodes.filter((node) => !$isElementNode(node) && node.isInline());
  const isEntireSelectionSpoiled = leaves.every((node) => {
    return $findMatchingParent(node, (parent) => parent instanceof SpoilerNode) !== null;
  });

  for (const node of leaves) {
    if (isEntireSelectionSpoiled) {
      $removeSelectedSpoiler(node);
      continue;
    }

    const existingSpoiler = $findMatchingParent(node, (parent) => parent instanceof SpoilerNode);
    if (existingSpoiler) {
      continue;
    }

    const spoiler = $createSpoilerNode();
    node.insertBefore(spoiler);
    spoiler.append(node);
  }
}

function $copySelectedSubtree(options: {
  node: LexicalNode;
  selectedKeys: ReadonlySet<string>;
}): LexicalNode | null {
  const { node, selectedKeys } = options;
  if (!$isElementNode(node)) {
    return selectedKeys.has(node.getKey()) ? $copyNode(node) : null;
  }

  const selectedChildren: LexicalNode[] = [];

  for (const child of node.getChildren()) {
    const selectedChild = $copySelectedSubtree({ node: child, selectedKeys });
    if (selectedChild) {
      selectedChildren.push(selectedChild);
    }
  }

  const hasSelectedContent = selectedChildren.length > 0 || selectedKeys.has(node.getKey());
  if (!hasSelectedContent) {
    return null;
  }

  const copiedElement = $copyNode(node);
  copiedElement.append(...selectedChildren);

  return copiedElement;
}

function $extractDetailsBody() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return [$createParagraphNode()];
  }

  // Extraction splits boundary text; cloning its selected ancestors preserves inline wrappers
  // and the block hierarchy required by list items, table cells, and custom emoji decorators.
  const selectedNodes = selection.extract();
  const selectedKeys = new Set(selectedNodes.map((node) => node.getKey()));
  const body: LexicalNode[] = [];

  for (const node of $getRoot().getChildren()) {
    const selectedBlock = $copySelectedSubtree({ node, selectedKeys });
    if (selectedBlock) {
      body.push(selectedBlock);
    }
  }

  selection.removeText();

  return body.length > 0 ? body : [$createParagraphNode()];
}

/** Insert a disclosure without discarding the selected content's rich structure. */
export function $insertComposerDetails() {
  const body = $extractDetailsBody();
  const details = $createDetailsNode();
  const summary = $createSummaryNode();
  summary.append($createTextNode('Details'));
  details.append(summary, ...body);
  $insertNodeToNearestRoot(details);
  summary.selectStart();
}

/** Remove character styling and links from the selected text. */
export function $clearComposerFormatting(editor: LexicalEditor) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return;
  }

  for (const node of selection.extract()) {
    if ($isTextNode(node)) {
      node.setFormat(0);
      node.setStyle('');
      $removeSelectedSpoiler(node);
    }
  }

  selection.setFormat(0);
  selection.setStyle('');
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
}

/** Read the currently selected link address for the link dialog. */
export function $getComposerLink() {
  const link = $findSelectedAncestor('link');
  return $isLinkNode(link) ? link.getURL() : '';
}

/** Change only the selected code block's language. */
export function $setComposerCodeLanguage(language: string) {
  const code = $findSelectedAncestor('code');
  if ($isCodeNode(code)) {
    code.setLanguage(language || undefined);
  }
}

/** Read the selected code language without assuming the parent block shape. */
export function $getComposerCodeLanguage() {
  const code = $findSelectedAncestor('code');
  return $isCodeNode(code) ? (code.getLanguage() ?? '') : '';
}

/** Remove an enclosing table while leaving a usable paragraph at its location. */
export function $removeComposerTable() {
  const table = $findSelectedAncestor('table');
  if (!$isElementNode(table)) {
    return;
  }

  const paragraph = $createParagraphNode();
  table.replace(paragraph);
  paragraph.selectStart();
}

/** Toggle the selected quote's sent presentation without changing its editable content. */
export function $toggleComposerQuoteCollapsed() {
  const quote = $findSelectedAncestor('quote');
  if (quote instanceof CollapsibleQuoteNode) {
    quote.setCollapsed({ isCollapsed: !quote.isCollapsed() });
  }
}

/** Read the selected quote's presentation for the formatting control. */
export function $isComposerQuoteCollapsed() {
  const quote = $findSelectedAncestor('quote');
  return quote instanceof CollapsibleQuoteNode && quote.isCollapsed();
}
