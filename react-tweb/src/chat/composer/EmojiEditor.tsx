import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  type RangeSelection,
} from 'lexical';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { CustomEmoji } from '../emoji/customEmojiCatalog';
import type { EmojiText } from '../emoji/customEmojiEntities';
import { CustomEmojiNode, $createCustomEmojiNode } from './CustomEmojiNode';
import { $readEmojiEditor, $replaceEmojiEditor } from './emojiEditorState';
import { shouldSubmitMessage } from './composerKeyboard';
import styles from './EmojiEditor.module.css';

// Lexical registers node classes by identity. A hot module update needs a new editor;
// ordinary renders keep this key, and the parent-owned draft survives the remount.
const EDITOR_INSTANCE_KEY = crypto.randomUUID();

export interface EmojiEditorControls {
  focus: () => void;
  insertEmoji: (emoji: string) => void;
  insertCustomEmoji: (emoji: CustomEmoji) => void;
  deleteCharacter: () => void;
}

interface EmojiEditorProps {
  value: EmojiText;
  label?: string;
  controlsRef: Ref<EmojiEditorControls>;
  placeholder: string;
  onChange: (value: EmojiText) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPasteImage: (file: File) => void;
  onError: (message: string) => void;
}

function EditorBridge({ value, controlsRef, onChange, onSubmit, onPasteImage }: EmojiEditorProps) {
  const [editor] = useLexicalComposerContext();
  const savedSelectionRef = useRef<RangeSelection | null>(null);
  const callbacksRef = useRef({ onChange, onSubmit, onPasteImage });
  callbacksRef.current = { onChange, onSubmit, onPasteImage };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          savedSelectionRef.current = selection.clone();
        }
        if (dirtyElements.size || dirtyLeaves.size) {
          callbacksRef.current.onChange($readEmojiEditor());
        }
      });
    });
  }, [editor]);

  useEffect(() => {
    const current = editor.getEditorState().read($readEmojiEditor);
    const isSame =
      current.text === value.text &&
      JSON.stringify(current.customEmoji) === JSON.stringify(value.customEmoji ?? []);
    if (isSame) {
      return;
    }
    // Only external changes replace the tree; ordinary typing preserves selection and undo.
    savedSelectionRef.current = null;
    editor.update(
      () => {
        $replaceEmojiEditor(value);
        $setSelection(null);
      },
      { tag: SKIP_DOM_SELECTION_TAG },
    );
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [editor, value]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (
          !event ||
          !shouldSubmitMessage({
            key: event.key,
            shiftKey: event.shiftKey,
            isComposing: editor.isComposing() || event.isComposing,
            keyCode: event.keyCode,
          })
        ) {
          return false;
        }
        event.preventDefault();
        callbacksRef.current.onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const file = 'clipboardData' in event ? event.clipboardData?.files[0] : undefined;
        if (!file) {
          return false;
        }
        event.preventDefault();
        callbacksRef.current.onPasteImage(file);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

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
      focus: () => editor.focus(),
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
          selection.deleteCharacter(true);
        }),
    };
  }, [editor]);
  return null;
}

/** Provide inline animated emoji with library-owned composition, selection, deletion and undo. */
export function EmojiEditor(props: EmojiEditorProps) {
  return (
    <LexicalComposer
      key={EDITOR_INSTANCE_KEY}
      initialConfig={{
        namespace: 'message-composer',
        nodes: [CustomEmojiNode],
        editorState: () => $replaceEmojiEditor(props.value),
        onError: (error) => {
          console.error('Message editor failed.', error);
          props.onError('Could not update the message editor.');
        },
      }}
    >
      <div className={styles.container}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className={styles.editor}
              aria-label={props.label ?? 'Message'}
              aria-placeholder={props.placeholder}
              placeholder={<span className={styles.placeholder}>{props.placeholder}</span>}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  props.onCancel();
                }
              }}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <EditorBridge {...props} />
    </LexicalComposer>
  );
}
