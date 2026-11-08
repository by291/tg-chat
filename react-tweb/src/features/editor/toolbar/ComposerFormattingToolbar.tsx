import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { FORMAT_TEXT_COMMAND, REDO_COMMAND, UNDO_COMMAND } from 'lexical';
import {
  CalendarDays,
  CodeXml,
  EyeOff,
  Link,
  List,
  Plus,
  Quote,
  Redo2,
  Sigma,
  Table,
  Undo2,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  $setComposerBlock,
  $toggleComposerSpoiler,
  $toggleComposerQuoteCollapsed,
} from '../richEditorCommands';
import { ComposerFormatDialog } from './ComposerFormatDialog';
import { ComposerToolbarMenu } from './ComposerToolbarMenu';
import { createComposerToolbarActions } from './composerToolbarActions';
import { EXTENDED_FORMATS, TEXT_FORMATS, type FormatAction } from './composerToolbarFormats';
import { useComposerDialogs } from './useComposerDialogs';
import { useComposerKeyboardShortcuts } from './useComposerKeyboardShortcuts';
import { useComposerToolbarSelection } from './useComposerToolbarSelection';
import styles from './ComposerFormattingToolbar.module.css';

const FLOATING_ICON_SIZE = 20;
const STANDARD_ICON_SIZE = 22;
const LARGE_ICON_SIZE = 23;

interface ComposerFormattingToolbarProps {
  isExpanded: boolean;
  onError: (message: string) => void;
}

/** Expose selection formatting and expanded block controls for the message editor. */
export function ComposerFormattingToolbar({ isExpanded, onError }: ComposerFormattingToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const {
    position,
    formats,
    isQuote,
    isQuoteCollapsed,
    isSpoiler,
    isInTable,
    isInCode,
    canUndo,
    canRedo,
    captureSelection,
    applyEditorChange,
    restoreSelection,
  } = useComposerToolbarSelection(editor);
  const { dialog, openDialog, closeDialog, submitDialog } = useComposerDialogs({
    editor,
    captureSelection,
    applyEditorChange,
    restoreSelection,
    onError,
  });
  useComposerKeyboardShortcuts({ editor, openDialog });

  function formatButton(action: FormatAction) {
    const Icon = action.icon;
    return (
      <button
        key={action.format}
        type="button"
        className={styles.button}
        aria-label={action.label}
        title={action.label}
        aria-pressed={formats.has(action.format)}
        onClick={() =>
          applyEditorChange(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, action.format))
        }
      >
        <Icon size={FLOATING_ICON_SIZE} />
      </button>
    );
  }

  const { blockActions, listActions, tableActions } = createComposerToolbarActions({
    editor,
    applyEditorChange,
    isInTable,
  });
  const menuProps = { onCaptureSelection: captureSelection, onRestoreSelection: restoreSelection };

  return (
    <>
      {position &&
        !dialog &&
        createPortal(
          <div
            className={styles.floating}
            style={position}
            role="toolbar"
            aria-label="Text formatting"
            onPointerDown={(event) => event.preventDefault()}
          >
            {TEXT_FORMATS.map(formatButton)}
            <button
              className={styles.button}
              type="button"
              aria-label="Quote"
              title="Quote"
              aria-pressed={isQuote}
              onClick={() => applyEditorChange(() => $setComposerBlock('quote'))}
            >
              <Quote size={FLOATING_ICON_SIZE} />
            </button>
            <span className={styles.separator} />
            <button
              className={styles.button}
              type="button"
              aria-label="Insert date"
              title="Insert date"
              onClick={() => openDialog('date')}
            >
              <CalendarDays size={FLOATING_ICON_SIZE} />
            </button>
            <button
              className={styles.button}
              type="button"
              aria-label="Edit link"
              title="Edit link"
              onClick={() => openDialog('link')}
            >
              <Link size={FLOATING_ICON_SIZE} />
            </button>
            <span className={styles.separator} />
            {formatButton(EXTENDED_FORMATS[0])}
            <button
              className={styles.button}
              type="button"
              aria-label="Spoiler"
              title="Spoiler"
              aria-pressed={isSpoiler}
              onClick={() => applyEditorChange($toggleComposerSpoiler)}
            >
              <EyeOff size={FLOATING_ICON_SIZE} />
            </button>
            {EXTENDED_FORMATS.slice(1).map(formatButton)}
          </div>,
          document.body,
        )}
      {isExpanded && (
        <>
          <div
            className={styles.history}
            role="toolbar"
            aria-label="Edit history"
            onPointerDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className={styles.button}
              aria-label="Undo"
              title="Undo"
              disabled={!canUndo}
              onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
            >
              <Undo2 size={STANDARD_ICON_SIZE} />
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label="Redo"
              title="Redo"
              disabled={!canRedo}
              onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
            >
              <Redo2 size={STANDARD_ICON_SIZE} />
            </button>
          </div>
          <div
            className={styles.bottom}
            role="toolbar"
            aria-label="Insert rich content"
            onPointerDown={(event) => event.preventDefault()}
          >
            <ComposerToolbarMenu
              label="More formatting"
              icon={<Plus size={LARGE_ICON_SIZE} />}
              actions={blockActions}
              {...menuProps}
            />
            <ComposerToolbarMenu
              label="Lists"
              icon={<List size={LARGE_ICON_SIZE} />}
              actions={listActions}
              {...menuProps}
            />
            <ComposerToolbarMenu
              label="Table"
              icon={<Table size={STANDARD_ICON_SIZE} />}
              actions={tableActions}
              {...menuProps}
            />
            <button
              type="button"
              className={styles.button}
              aria-label="Edit link"
              title="Edit link"
              onClick={() => openDialog('link')}
            >
              <Link size={STANDARD_ICON_SIZE} />
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label="Code block"
              title="Code block"
              aria-pressed={isInCode}
              onClick={() => applyEditorChange(() => $setComposerBlock('code'))}
            >
              <CodeXml size={LARGE_ICON_SIZE} />
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label="Insert formula"
              title="Insert formula"
              onClick={() => openDialog('math')}
            >
              <Sigma size={LARGE_ICON_SIZE} />
            </button>
            {isQuote && (
              <button
                type="button"
                className={styles.language}
                aria-pressed={isQuoteCollapsed}
                onClick={() => applyEditorChange($toggleComposerQuoteCollapsed)}
              >
                Send quote collapsed
              </button>
            )}
            {isInCode && (
              <button
                type="button"
                className={styles.language}
                onClick={() => openDialog('language')}
              >
                Language
              </button>
            )}
          </div>
        </>
      )}
      {dialog && (
        <ComposerFormatDialog
          kind={dialog.kind}
          initialValue={dialog.value}
          onSubmit={submitDialog}
          onClose={closeDialog}
          getEditorElement={() => editor.getRootElement()}
        />
      )}
    </>
  );
}
