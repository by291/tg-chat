import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { $readEmojiEditor, $replaceEmojiEditor } from './emojiEditorState';

const EXTERNAL_VALUE_TAG = 'external-composer-value';

interface EditorValueSynchronizationOptions {
  editor: LexicalEditor;
  value: EmojiText;
  savedSelectionRef: RefObject<RangeSelection | null>;
  onChange: (value: EmojiText) => void;
}

function isSameEditorValue(current: EmojiText, incoming: EmojiText) {
  if (current.text !== incoming.text || (current.richText ?? '') !== (incoming.richText ?? '')) {
    return false;
  }

  const currentEmoji = current.customEmoji ?? [];
  const incomingEmoji = incoming.customEmoji ?? [];
  if (currentEmoji.length !== incomingEmoji.length) {
    return false;
  }

  return currentEmoji.every((entity, index) => {
    const candidate = incomingEmoji[index];
    return (
      entity.documentId === candidate.documentId &&
      entity.offset === candidate.offset &&
      entity.length === candidate.length
    );
  });
}

/** Publish local edits and replace external drafts while retaining one shared caret owner. */
export function useEditorValueSynchronization({
  editor,
  value,
  savedSelectionRef,
  onChange,
}: EditorValueSynchronizationOptions) {
  const publishedValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      editorState.read(
        () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            savedSelectionRef.current = selection.clone();
          }

          const hasContentChanges = dirtyElements.size > 0 || dirtyLeaves.size > 0;
          if (!hasContentChanges || tags.has(EXTERNAL_VALUE_TAG)) {
            return;
          }

          const nextValue = $readEmojiEditor();
          // Node transforms can mark an unchanged document dirty; only persist real edits.
          if (isSameEditorValue(publishedValueRef.current, nextValue)) {
            return;
          }

          publishedValueRef.current = nextValue;
          onChangeRef.current(nextValue);
        },
        { editor },
      );
    });
  }, [editor, savedSelectionRef]);

  useLayoutEffect(
    () => {
      const current = editor.getEditorState().read($readEmojiEditor, { editor });
      if (isSameEditorValue(current, value)) {
        return;
      }

      // Only external changes replace the tree; ordinary typing preserves selection and undo.
      savedSelectionRef.current = null;
      publishedValueRef.current = value;
      editor.update(
        () => {
          $replaceEmojiEditor(value);
          $setSelection(null);
        },
        // Apply external clears before a pending focus update can publish the old draft again.
        { tag: [SKIP_DOM_SELECTION_TAG, EXTERNAL_VALUE_TAG], discrete: true },
      );
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    },
    // prettier-ignore
    [
      editor,
      value,
      savedSelectionRef,
    ],
  );
}
