// @vitest-environment jsdom
import { $createCodeNode } from '@lexical/code';
import { createEditor, $createTextNode, $getRoot, $isTextNode, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { CUSTOM_EMOJI } from '../emoji/customEmojiCatalog';
import { CustomEmojiNode } from './CustomEmojiNode';
import { $createMathNode, RICH_EDITOR_NODES } from './richEditorNodes';
import { $readEmojiEditor, $replaceEmojiEditor } from './emojiEditorState';

const emoji = CUSTOM_EMOJI[0];

function createRichEditor(): LexicalEditor {
  return createEditor({
    namespace: 'rich-message-state-test',
    nodes: [CustomEmojiNode, ...RICH_EDITOR_NODES],
    onError: (error) => {
      throw error;
    },
  });
}

describe('rich editor interchange', () => {
  it('retains a standalone formula through sanitization and draft restoration', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        $getRoot().append($createMathNode({ source: 'x^2 + y^2', isBlock: true }));
      },
      { discrete: true },
    );
    const value = editor.read($readEmojiEditor);
    expect(value.richText).toContain('data-math="x^2 + y^2"');
    expect(value.richText).toContain('data-math-display="block"');

    const restored = createRichEditor();
    restored.update(() => $replaceEmojiEditor(value), { discrete: true });
    expect(restored.read($readEmojiEditor)).toEqual(value);
  });

  it('restores overlapping inline marks and atomic emoji without duplicating fallback text', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        $replaceEmojiEditor({
          text: '',
          richText:
            '<p><strong>Bold <em>and italic</em></strong> ' +
            `<span data-custom-emoji="${emoji.id}">${emoji.emoji}</span></p>`,
        });
      },
      { discrete: true },
    );
    const value = editor.read($readEmojiEditor);
    expect(value.text).toBe(`Bold and italic ${emoji.emoji}`);
    expect(value.customEmoji).toEqual([
      {
        documentId: emoji.id,
        offset: 'Bold and italic '.length,
        length: emoji.emoji.length,
      },
    ]);
    expect(value.richText).toContain('<strong>');
    const markup = new DOMParser().parseFromString(value.richText ?? '', 'text/html');
    expect(markup.querySelector('em, i')?.textContent).toBe('and italic');

    const restored = createRichEditor();
    restored.update(() => $replaceEmojiEditor(value), { discrete: true });
    expect(restored.read($readEmojiEditor)).toEqual(value);
  });

  it('keeps emoji offsets aligned with the library text representation inside lists and tables', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        $replaceEmojiEditor({
          text: '',
          richText:
            '<ul><li>First</li><li>Second</li></ul><table><tbody><tr>' +
            `<td><p>Cell <span data-custom-emoji="${emoji.id}">${emoji.emoji}</span></p></td>` +
            '<td><p>Next</p></td></tr></tbody></table>',
        });
      },
      { discrete: true },
    );
    const value = editor.read($readEmojiEditor);
    const entity = value.customEmoji[0];
    expect(value.text.slice(entity.offset, entity.offset + entity.length)).toBe(emoji.emoji);
    const restored = createRichEditor();
    restored.update(() => $replaceEmojiEditor(value), { discrete: true });
    expect(restored.read($readEmojiEditor).text).toBe(value.text);
    expect(restored.read($readEmojiEditor).customEmoji).toEqual(value.customEmoji);
  });

  it('stores code language in portable HTML and restores it for further editing', () => {
    const editor = createRichEditor();
    editor.update(
      () => {
        const code = $createCodeNode('javascript');
        code.append($createTextNode('const n = 1;'));
        const root = $getRoot();
        root.clear();
        root.append(code);
      },
      { discrete: true },
    );
    const value = editor.read($readEmojiEditor);
    expect(value.richText).toContain('data-code-language="javascript"');
    const restored = createRichEditor();
    restored.update(() => $replaceEmojiEditor(value), { discrete: true });
    expect(restored.read($readEmojiEditor).richText).toBe(value.richText);
  });

  it('does not store rich markup for an ordinary emoji draft', () => {
    const editor = createRichEditor();
    editor.update(() => $replaceEmojiEditor({ text: 'Plain\ntext' }), { discrete: true });
    expect(editor.read($readEmojiEditor)).toEqual({ text: 'Plain\ntext', customEmoji: [] });
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if ($isTextNode(text)) {
          text.toggleFormat('bold');
        }
      },
      { discrete: true },
    );
    expect(editor.read($readEmojiEditor).richText).toContain('<strong>');
  });
});
