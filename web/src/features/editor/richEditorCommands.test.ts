// @vitest-environment jsdom
import { $createLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isTextNode,
  $isRangeSelection,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $createCustomEmojiNode, CustomEmojiNode } from './nodes/CustomEmojiNode';
import {
  $insertComposerDetails,
  $setComposerBlock,
  $toggleComposerSpoiler,
} from './richEditorCommands';
import {
  $createMathNode,
  $createMessageDateNode,
  $createSpoilerNode,
  RICH_EDITOR_NODES,
} from './nodes/richEditorNodes';

function createRichEditor() {
  return createEditor({
    namespace: 'rich-editor-commands-test',
    nodes: [...RICH_EDITOR_NODES, CustomEmojiNode],
    onError: (error) => {
      throw error;
    },
  });
}

describe('rich editor commands', () => {
  it('wraps only the selected substring in a spoiler and preserves the range', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Before secret after');
        paragraph.append(text);
        $getRoot().append(paragraph);
        text.select(7, 13);
        $toggleComposerSpoiler();
        expect($getSelection()?.getTextContent()).toBe('secret');
      },
      { discrete: true },
    );

    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('[data-spoiler]')?.textContent).toBe('secret');
    expect(document.body.textContent).toBe('Before secret after');
  });

  it('removes a spoiler from only the selected substring', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const spoiler = $createSpoilerNode();
        const text = $createTextNode('Before secret after');
        spoiler.append(text);
        paragraph.append(spoiler);
        $getRoot().append(paragraph);
        text.select(7, 13);
        $toggleComposerSpoiler();
        expect($getSelection()?.getTextContent()).toBe('secret');
      },
      { discrete: true },
    );

    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const document = new DOMParser().parseFromString(html, 'text/html');
    const spoilers = Array.from(document.querySelectorAll('[data-spoiler]'));
    expect(spoilers.map((element) => element.textContent)).toEqual(['Before ', ' after']);
    expect(document.body.textContent).toBe('Before secret after');
  });

  it('moves a partial rich selection into details without flattening marks or custom emoji', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const firstText = $createTextNode('Before bold').setFormat('bold');
        const link = $createLinkNode('https://example.com');
        link.append($createTextNode(' linked '));
        const spoiler = $createSpoilerNode();
        spoiler.append($createTextNode('secret'));
        const emoji = $createCustomEmojiNode({ documentId: 'example-emoji', text: '🙂' });
        const lastText = $createTextNode(' end after');
        paragraph.append(firstText, link);
        paragraph.append(spoiler, emoji, lastText);
        $getRoot().append(paragraph);
        firstText.select(7, 7);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          throw new Error('Expected a text selection.');
        }

        selection.focus.set(lastText.getKey(), 4, 'text');
        $insertComposerDetails();
      },
      { discrete: true },
    );

    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const document = new DOMParser().parseFromString(html, 'text/html');
    const details = document.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('Details');
    expect(details?.querySelector('b, strong')?.textContent).toBe('bold');
    expect(details?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(details?.querySelector('[data-spoiler]')?.textContent).toBe('secret');
    expect(details?.querySelector('[data-custom-emoji]')?.getAttribute('data-custom-emoji')).toBe(
      'example-emoji',
    );
    expect(details?.textContent).toBe('Detailsbold linked secret🙂 end');
    details?.remove();
    expect(document.body.textContent).toBe('Before  after');
  });

  it('keeps selected list items inside their list when wrapping them in details', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        const list = $createListNode('bullet');
        const firstItem = $createListItemNode();
        const secondItem = $createListItemNode();
        const firstText = $createTextNode('First');
        const secondText = $createTextNode('Second');
        firstItem.append(firstText);
        secondItem.append(secondText);
        list.append(firstItem, secondItem);
        $getRoot().append(list);
        firstText.select(2, 2);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          throw new Error('Expected a text selection.');
        }

        selection.focus.set(secondText.getKey(), 3, 'text');
        $insertComposerDetails();
      },
      { discrete: true },
    );

    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const document = new DOMParser().parseFromString(html, 'text/html');
    const items = document.querySelectorAll('details > ul > li');
    expect(Array.from(items, (item) => item.textContent)).toEqual(['rst', 'Sec']);
    expect(document.querySelector('details > p > ul')).toBeNull();
  });

  it('keeps inline marks when converting a paragraph to a heading and back', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Marked title');
        text.setFormat('bold');
        paragraph.append(text);
        $getRoot().append(paragraph);
        text.select(0, 12);
        $setComposerBlock('h2');
        expect($getRoot().getFirstChild()?.getType()).toBe('heading');
        $setComposerBlock('paragraph');
        const textNode = $getRoot().getAllTextNodes()[0];
        expect($isTextNode(textNode) && textNode.hasFormat('bold')).toBe(true);
        expect($getRoot().getFirstChild()?.getType()).toBe('paragraph');
      },
      { discrete: true },
    );
  });

  it('round-trips formulas and dates without treating their text as editable children', () => {
    const editor = createRichEditor();
    const timestamp = 1_800_000_000_000;
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createMathNode({ source: 'x^2', isBlock: false }),
          $createMessageDateNode({ timestamp, label: 'Tomorrow' }),
        );
        $getRoot().append(paragraph);
      },
      { discrete: true },
    );
    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));

    const restored = createRichEditor();
    restored.update(
      () => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        const nodes = $generateNodesFromDOM(restored, document);
        $getRoot().append(...nodes);
      },
      { discrete: true },
    );

    restored.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('x^2Tomorrow');
      const restoredHtml = $generateHtmlFromNodes(restored);
      expect(restoredHtml).toContain('data-math="x^2"');
      expect(restoredHtml).toContain(`data-message-date="${timestamp}"`);
    });
  });
});
