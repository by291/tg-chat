import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { useImperativeHandle, type Ref, type RefObject } from 'react';
import type { CustomEmoji } from '@/features/emoji/customEmojiCatalog';
import { $createCustomEmojiNode } from './nodes/CustomEmojiNode';

export interface EmojiEditorControls {
  /** Focus the editable surface with a fallback caret at the end. */
  focus: () => void;
  /** Resolve the current editable surface after a dialog closes or an editor remounts. */
  getElement: () => HTMLElement | null;
  /** Insert Unicode emoji at the saved caret. */
  insertEmoji: (emoji: string) => void;
  /** Insert a custom emoji node at the saved caret. */
  insertCustomEmoji: (emoji: CustomEmoji) => void;
  /** Delete the character immediately before the saved caret. */
  deleteCharacter: () => void;
}

interface EditorControlsOptions {
  editor: LexicalEditor;
  controlsRef: Ref<EmojiEditorControls>;
  savedSelectionRef: RefObject<RangeSelection | null>;
}

/** Expose palette actions that restore the shared caret without stealing palette focus. */
export function useEditorControls({
  editor,
  controlsRef,
  savedSelectionRef,
}: EditorControlsOptions) {
  useImperativeHandle(controlsRef, () => {
    function updateSelection(change: (selection: RangeSelection) => void) {
      // Search may own DOM focus; palette insertion still targets the saved composer caret.
      const hasEditorFocus = editor.getRootElement() === document.activeElement;
      const updateTags = hasEditorFocus ? [] : [SKIP_DOM_SELECTION_TAG];
      editor.update(
        () => {
          const saved = savedSelectionRef.current;
          if (saved) {
            $setSelection(saved.clone());
          } else {
            $getRoot().selectEnd();
          }

          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            change(selection);
          }
        },
        { tag: updateTags },
      );
    }

    return {
      focus: () => editor.focus(undefined, { defaultSelection: 'rootEnd' }),
      getElement: () => editor.getRootElement(),
      insertEmoji: (emoji) => updateSelection((selection) => selection.insertText(emoji)),
      insertCustomEmoji: (emoji) =>
        updateSelection((selection) => {
          selection.insertNodes([
            $createCustomEmojiNode({ documentId: emoji.id, text: emoji.emoji }),
          ]);
        }),
      deleteCharacter: () =>
        updateSelection((selection) => {
          // Lexical deletes a decorator atomically, including joined Unicode fallback sequences.
          const isBackward = true;
          selection.deleteCharacter(isBackward);
        }),
    };
  }, [editor, savedSelectionRef]);
}
