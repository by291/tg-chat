import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $generateNodesFromDOM } from '@lexical/html';
import { $isListItemNode } from '@lexical/list';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  $insertNodes,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  type RangeSelection,
} from 'lexical';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import type { CustomEmoji } from '../emoji/customEmojiCatalog';
import type { EmojiText } from '../emoji/customEmojiEntities';
import { CustomEmojiNode, $createCustomEmojiNode } from './CustomEmojiNode';
import { $readEmojiEditor, $replaceEmojiEditor } from './emojiEditorState';
import { shouldSubmitMessage } from './composerKeyboard';
import { useEditorHeight } from './useEditorHeight';
import { RICH_EDITOR_NODES } from './richEditorNodes';
import { RICH_EDITOR_THEME } from './richEditorTheme';
import { RichEditorPlugins } from './RichEditorPlugins';
import { ComposerFormattingToolbar } from './ComposerFormattingToolbar';
import { parseRichEditorHtml } from './richEditorHtml';
import styles from './EmojiEditor.module.css';

// Lexical registers node classes by identity. A hot module update needs a new editor;
// ordinary renders keep this key, and the parent-owned draft survives the remount.
const EDITOR_INSTANCE_KEY = crypto.randomUUID();
const EXTERNAL_VALUE_TAG = 'external-composer-value';

export interface EmojiEditorControls {
  focus: () => void;
  /** Resolve the current editable surface after a dialog closes or an editor remounts. */
  getElement: () => HTMLElement | null;
  insertEmoji: (emoji: string) => void;
  insertCustomEmoji: (emoji: CustomEmoji) => void;
  deleteCharacter: () => void;
}

interface EmojiEditorProps {
  isComposer?: boolean;
  isExpanded?: boolean;
  onHeightChange?: (height: number) => void;
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

function EditorBridge({ value, controlsRef, onChange, onSubmit, onPasteImage }: EmojiEditorProps) {
  const [editor] = useLexicalComposerContext();
  const savedSelectionRef = useRef<RangeSelection | null>(null);
  const publishedValueRef = useRef(value);
  const callbacksRef = useRef({
    onChange,
    onSubmit,
    onPasteImage,
  });
  callbacksRef.current = {
    onChange,
    onSubmit,
    onPasteImage,
  };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      editorState.read(
        () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            savedSelectionRef.current = selection.clone();
          }
          const hasContentChanges = dirtyElements.size > 0 || dirtyLeaves.size > 0;
          if (hasContentChanges && !tags.has(EXTERNAL_VALUE_TAG)) {
            const nextValue = $readEmojiEditor();
            // Node transforms can mark an unchanged document dirty; only persist real edits.
            if (!isSameEditorValue(publishedValueRef.current, nextValue)) {
              publishedValueRef.current = nextValue;
              callbacksRef.current.onChange(nextValue);
            }
          }
        },
        { editor },
      );
    });
  }, [editor]);

  useLayoutEffect(() => {
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
  }, [editor, value]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey && !editor.isComposing() && !event.isComposing) {
          const selection = $getSelection();
          const parents = $isRangeSelection(selection)
            ? selection.anchor.getNode().getParents()
            : [];
          const isStructuredBlock = parents.some((parent) => {
            return $isListItemNode(parent) || $isHeadingNode(parent) || $isQuoteNode(parent);
          });
          if (isStructuredBlock) {
            event.preventDefault();
            editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
            return true;
          }
        }
        if (
          !event ||
          !shouldSubmitMessage({
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
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
        const clipboard = 'clipboardData' in event ? event.clipboardData : undefined;
        const file = clipboard?.files[0];
        if (file) {
          event.preventDefault();
          callbacksRef.current.onPasteImage(file);
          return true;
        }
        const html = clipboard?.getData('text/html');
        if (!html) {
          return false;
        }
        // The same allowlist protects pasted markup, stored drafts, and displayed messages.
        event.preventDefault();
        const document = parseRichEditorHtml(html);
        $insertNodes($generateNodesFromDOM(editor, document));
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
          selection.deleteCharacter(true);
        }),
    };
  }, [editor]);
  return null;
}

function EditorSurface(props: EmojiEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  useEditorHeight({
    containerRef,
    inputRef,
    isEnabled: props.isComposer ?? false,
    isExpanded: props.isExpanded ?? false,
    onHeightChange: props.onHeightChange,
  });

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-composer={props.isComposer}
      data-expanded={props.isExpanded}
    >
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            ref={inputRef}
            className={styles.editor}
            aria-label={props.label ?? 'Message'}
            aria-multiline="true"
            aria-placeholder={props.placeholder}
            placeholder={<span className={styles.placeholder}>{props.placeholder}</span>}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // Cancel the composer context without also closing a surrounding chat layer.
                event.preventDefault();
                event.stopPropagation();
                props.onCancel();
              }
            }}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ComposerFormattingToolbar isExpanded={props.isExpanded ?? false} onError={props.onError} />
    </div>
  );
}

/** Provide inline animated emoji with library-owned composition, selection, deletion and undo. */
export function EmojiEditor(props: EmojiEditorProps) {
  return (
    <LexicalComposer
      key={EDITOR_INSTANCE_KEY}
      initialConfig={{
        namespace: 'message-composer',
        nodes: [CustomEmojiNode, ...RICH_EDITOR_NODES],
        theme: RICH_EDITOR_THEME,
        editorState: () => $replaceEmojiEditor(props.value),
        onError: (error) => {
          console.error('Message editor failed.', error);
          props.onError('Could not update the message editor.');
        },
      }}
    >
      {/* Keep measurement observers in the same lifecycle as the editable DOM during hot updates. */}
      <EditorSurface {...props} />
      <HistoryPlugin />
      <RichEditorPlugins />
      <EditorBridge {...props} />
    </LexicalComposer>
  );
}
