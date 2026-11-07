// @vitest-environment jsdom
import { createEditor, $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import { describe, expect, it } from 'vitest';
import { CUSTOM_EMOJI } from '../emoji/customEmojiCatalog';
import { CustomEmojiNode } from './CustomEmojiNode';
import { $readEmojiEditor, $replaceEmojiEditor } from './emojiEditorState';

const exampleEmoji = CUSTOM_EMOJI[0];

function createEmojiEditor() {
  return createEditor({
    namespace: 'emoji-state-test',
    nodes: [CustomEmojiNode],
    onError: (error) => {
      throw error;
    },
  });
}

describe('custom emoji editing', () => {
  it('preserves multiline text and UTF-16 offsets when restoring a draft', () => {
    const editor = createEmojiEditor();
    const prefix = '🌿 First line\n';
    const value = {
      text: `${prefix}${exampleEmoji.emoji} after`,
      customEmoji: [
        { documentId: exampleEmoji.id, offset: prefix.length, length: exampleEmoji.emoji.length },
      ],
    };
    editor.update(() => $replaceEmojiEditor(value), { discrete: true });

    expect(editor.getEditorState().read($readEmojiEditor)).toEqual(value);
  });

  it('deletes the entire custom emoji without leaving a partial Unicode sequence', () => {
    const editor = createEmojiEditor();
    editor.update(
      () => {
        $replaceEmojiEditor({
          text: `Keep ${exampleEmoji.emoji}`,
          customEmoji: [
            { documentId: exampleEmoji.id, offset: 5, length: exampleEmoji.emoji.length },
          ],
        });
        $getRoot().selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.deleteCharacter(true);
        }
      },
      { discrete: true },
    );

    expect(editor.getEditorState().read($readEmojiEditor)).toEqual({
      text: 'Keep ',
      customEmoji: [],
    });
  });

  it('retains an unavailable custom emoji as readable text', () => {
    const editor = createEmojiEditor();
    editor.update(
      () => {
        $replaceEmojiEditor({
          text: 'Hi 😂',
          customEmoji: [{ documentId: 'unavailable', offset: 3, length: 2 }],
        });
      },
      { discrete: true },
    );

    expect(editor.getEditorState().read($readEmojiEditor)).toEqual({
      text: 'Hi 😂',
      customEmoji: [],
    });
  });
});
