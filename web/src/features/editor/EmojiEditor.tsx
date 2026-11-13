import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import type { RangeSelection } from 'lexical';
import { useRef, type Ref } from 'react';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { CustomEmojiNode } from './nodes/CustomEmojiNode';
import { $replaceEmojiEditor } from './emojiEditorState';
import { useEditorValueSynchronization } from './useEditorValueSynchronization';
import { useEditorInputCommands } from './useEditorInputCommands';
import { useEditorControls, type EmojiEditorControls } from './useEditorControls';
import { useEditorHeight } from './useEditorHeight';
import { RICH_EDITOR_NODES } from './nodes/richEditorNodes';
import { RICH_EDITOR_THEME } from './richEditorTheme';
import { RichEditorPlugins } from './RichEditorPlugins';
import { ComposerFormattingToolbar } from './toolbar/ComposerFormattingToolbar';
import styles from './EmojiEditor.module.css';

// Lexical registers node classes by identity. A hot module update needs a new editor;
// ordinary renders keep this key, and the parent-owned draft survives the remount.
const EDITOR_INSTANCE_KEY = crypto.randomUUID();

export type { EmojiEditorControls } from './useEditorControls';

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

// Lexical unmounts its placeholder on input; our persistent sibling must finish its exit animation.
function renderNoPlaceholder() {
  return null;
}

function EditorBridge({ value, controlsRef, onChange, onSubmit, onPasteImage }: EmojiEditorProps) {
  const [editor] = useLexicalComposerContext();
  const savedSelectionRef = useRef<RangeSelection | null>(null);

  // Keep update tracking before input registration so every adapter shares the latest caret.
  useEditorValueSynchronization({
    editor,
    value,
    savedSelectionRef,
    onChange,
  });
  useEditorInputCommands({
    editor,
    onSubmit,
    onPasteImage,
  });
  useEditorControls({
    editor,
    controlsRef,
    savedSelectionRef,
  });

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
            placeholder={renderNoPlaceholder}
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
      <span
        className={styles.placeholder}
        data-visible={!props.value.text && !props.value.richText}
        aria-hidden="true"
      >
        {props.placeholder}
      </span>
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
      {/* Keep observers attached to the editable DOM across hot updates. */}
      <EditorSurface {...props} />
      <HistoryPlugin />
      <RichEditorPlugins />
      <EditorBridge {...props} />
    </LexicalComposer>
  );
}
