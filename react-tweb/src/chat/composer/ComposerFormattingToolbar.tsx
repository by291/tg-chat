import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  INSERT_TABLE_COMMAND,
} from '@lexical/table';
import { $insertNodeToNearestRoot, mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type RangeSelection,
  type TextFormatType,
} from 'lexical';
import {
  Bold,
  CalendarDays,
  Code,
  CodeXml,
  EyeOff,
  Highlighter,
  Italic,
  Link,
  List,
  Plus,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ComposerFormatDialog,
  type ComposerDialogKind,
  type ComposerDialogValue,
} from './ComposerFormatDialog';
import { ComposerToolbarMenu, type ComposerMenuAction } from './ComposerToolbarMenu';
import {
  $clearComposerFormatting,
  $findSelectedAncestor,
  $getComposerCodeLanguage,
  $getComposerLink,
  $insertComposerDetails,
  $isComposerQuoteCollapsed,
  $removeComposerTable,
  $setComposerBlock,
  $setComposerCodeLanguage,
  $toggleComposerSpoiler,
  $toggleComposerQuoteCollapsed,
} from './richEditorCommands';
import {
  $createMathNode,
  $createMessageDateNode,
  MathNode,
  MessageDateNode,
} from './richEditorNodes';
import styles from './ComposerFormattingToolbar.module.css';

interface ComposerFormattingToolbarProps {
  isExpanded: boolean;
  onError: (message: string) => void;
}

interface ToolbarPosition {
  top: number;
  left: number;
  maxWidth: number;
}

interface FormatAction {
  label: string;
  format: TextFormatType;
  icon: LucideIcon;
}

interface OpenDialog {
  kind: ComposerDialogKind;
  value: ComposerDialogValue;
  nodeKey?: string;
}

const TOOLBAR_GAP = 8;
const TOOLBAR_HEIGHT = 48;
const TOOLBAR_WIDTH = 584;
const MINIMUM_VIEWPORT_GUTTER = 12;
const DEFAULT_TABLE_SIZE = '3';
const TEXT_FORMATS: FormatAction[] = [
  {
    label: 'Bold',
    format: 'bold',
    icon: Bold,
  },
  {
    label: 'Italic',
    format: 'italic',
    icon: Italic,
  },
  {
    label: 'Underline',
    format: 'underline',
    icon: Underline,
  },
  {
    label: 'Strikethrough',
    format: 'strikethrough',
    icon: Strikethrough,
  },
];
const EXTENDED_FORMATS: FormatAction[] = [
  {
    label: 'Monospace',
    format: 'code',
    icon: Code,
  },
  {
    label: 'Highlight',
    format: 'highlight',
    icon: Highlighter,
  },
  {
    label: 'Subscript',
    format: 'subscript',
    icon: Subscript,
  },
  {
    label: 'Superscript',
    format: 'superscript',
    icon: Superscript,
  },
];
const FORMAT_SHORTCUTS: Readonly<Record<string, TextFormatType>> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strikethrough',
  m: 'code',
};
const HEADING_FORMATS = [
  { tag: 'h1', label: 'Heading 1' },
  { tag: 'h2', label: 'Heading 2' },
  { tag: 'h3', label: 'Heading 3' },
  { tag: 'h4', label: 'Heading 4' },
  { tag: 'h5', label: 'Heading 5' },
  { tag: 'h6', label: 'Heading 6' },
] as const;

function getSelectionPosition(root: HTMLElement | null): ToolbarPosition | null {
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount || selection.isCollapsed) {
    return null;
  }
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (typeof range.getBoundingClientRect !== 'function') {
    return null;
  }
  const rectangle = range.getBoundingClientRect();
  const maxWidth = window.innerWidth - MINIMUM_VIEWPORT_GUTTER * 2;
  const width = Math.min(TOOLBAR_WIDTH, maxWidth);
  const centeredLeft = rectangle.left + rectangle.width / 2 - width / 2;
  const rightLimit = window.innerWidth - width - MINIMUM_VIEWPORT_GUTTER;
  const left = Math.max(MINIMUM_VIEWPORT_GUTTER, Math.min(centeredLeft, rightLimit));
  const top = Math.max(MINIMUM_VIEWPORT_GUTTER, rectangle.top - TOOLBAR_HEIGHT - TOOLBAR_GAP);
  return {
    top,
    left,
    maxWidth,
  };
}

function getCurrentDateInput(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function replaceFormula(options: { previous: MathNode; replacement: MathNode }) {
  const { previous, replacement } = options;
  if (previous.isInline() === replacement.isInline()) {
    previous.replace(replacement);
    return;
  }
  if (replacement.isInline()) {
    const paragraph = $createParagraphNode();
    paragraph.append(replacement);
    previous.replace(paragraph);
    paragraph.selectEnd();
    return;
  }
  // A block formula must split its current paragraph rather than become a block inside it.
  previous.selectPrevious();
  previous.remove();
  $insertNodeToNearestRoot(replacement);
}

/** Expose selection formatting and expanded block controls for the message editor. */
export function ComposerFormattingToolbar({ isExpanded, onError }: ComposerFormattingToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const savedSelectionRef = useRef<RangeSelection | null>(null);
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const [formats, setFormats] = useState<Set<TextFormatType>>(new Set());
  const [isQuote, setIsQuote] = useState(false);
  const [isQuoteCollapsed, setIsQuoteCollapsed] = useState(false);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [isInTable, setIsInTable] = useState(false);
  const [isInCode, setIsInCode] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

  const captureSelection = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        savedSelectionRef.current = selection.clone();
      }
    });
  }, [editor]);

  const applyEditorChange = useCallback(
    (updateContent: () => void) => {
      editor.update(() => {
        // Dialogs own DOM focus, so restore the editor range before applying formatting.
        const savedSelection = savedSelectionRef.current;
        if (savedSelection) {
          $setSelection(savedSelection.clone());
        } else {
          $getRoot().selectEnd();
        }
        updateContent();
        const currentSelection = $getSelection();
        if ($isRangeSelection(currentSelection)) {
          savedSelectionRef.current = currentSelection.clone();
        }
      });
      editor.focus();
    },
    [editor],
  );

  const restoreSelection = useCallback(() => {
    applyEditorChange(() => undefined);
  }, [applyEditorChange]);

  const openDialog = useCallback(
    (kind: ComposerDialogKind) => {
      captureSelection();
      let text = '';
      editor.getEditorState().read(() => {
        if (kind === 'link') {
          text = $getComposerLink();
        } else if (kind === 'language') {
          text = $getComposerCodeLanguage();
        } else if (kind === 'math') {
          text = $getSelection()?.getTextContent() ?? '';
        }
      });
      if (kind === 'date') {
        text = getCurrentDateInput();
      }
      setDialog({ kind, value: { text, isBlock: false } });
    },
    [captureSelection, editor],
  );

  useEffect(() => {
    function updateState() {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setPosition(null);
          return;
        }
        savedSelectionRef.current = selection.clone();
        const activeFormats = new Set<TextFormatType>();
        for (const action of [...TEXT_FORMATS, ...EXTENDED_FORMATS]) {
          if (selection.hasFormat(action.format)) {
            activeFormats.add(action.format);
          }
        }
        setFormats(activeFormats);
        setIsQuote($findSelectedAncestor('quote') !== null);
        setIsQuoteCollapsed($isComposerQuoteCollapsed());
        setIsSpoiler($findSelectedAncestor('spoiler') !== null);
        setIsInTable($findSelectedAncestor('table') !== null);
        setIsInCode($findSelectedAncestor('code') !== null);
      });
      setPosition(getSelectionPosition(editor.getRootElement()));
    }
    const removeListeners = mergeRegister(
      editor.registerUpdateListener(updateState),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          setCanUndo(value);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          setCanRedo(value);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) {
            return false;
          }
          const key = event.key.toLowerCase();
          const format = FORMAT_SHORTCUTS[key];
          if (!format && key !== 'p' && key !== 'k') {
            return false;
          }
          event.preventDefault();
          if (format) {
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
          } else if (key === 'p') {
            $toggleComposerSpoiler();
          } else {
            openDialog('link');
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
    document.addEventListener('selectionchange', updateState);
    window.addEventListener('resize', updateState);
    window.addEventListener('scroll', updateState, { capture: true });
    return () => {
      removeListeners();
      document.removeEventListener('selectionchange', updateState);
      window.removeEventListener('resize', updateState);
      window.removeEventListener('scroll', updateState, { capture: true });
    };
  }, [editor, openDialog]);

  useEffect(() => {
    function editEmbeddedContent(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      editor.getEditorState().read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        if (node instanceof MathNode) {
          const value = node.getValue();
          setDialog({
            kind: 'math',
            value: { text: value.source, isBlock: value.isBlock },
            nodeKey: node.getKey(),
          });
          event.preventDefault();
        } else if (node instanceof MessageDateNode) {
          setDialog({
            kind: 'date',
            value: { text: getCurrentDateInput(node.getTimestamp()), isBlock: false },
            nodeKey: node.getKey(),
          });
          event.preventDefault();
        }
      });
    }
    return editor.registerRootListener((root, previousRoot) => {
      previousRoot?.removeEventListener('dblclick', editEmbeddedContent);
      root?.addEventListener('dblclick', editEmbeddedContent);
    });
  }, [editor]);

  function closeDialog() {
    setDialog(null);
    restoreSelection();
  }

  function submitDialog(value: ComposerDialogValue) {
    if (!dialog) {
      return;
    }
    const text = value.text.trim();
    if (dialog.kind === 'link' && text && !/^(https?:\/\/|mailto:|tel:|tg:\/\/)/i.test(text)) {
      onError('Enter a valid https, http, mailto, tel, or Telegram link.');
      return;
    }
    const kind = dialog.kind;
    const nodeKey = dialog.nodeKey;
    setDialog(null);
    applyEditorChange(() => {
      if (kind === 'link') {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, text || null);
      } else if (kind === 'date') {
        const date = $createMessageDateNode({ timestamp: new Date(text).getTime() });
        const previous = nodeKey ? $getNodeByKey(nodeKey) : null;
        if (previous instanceof MessageDateNode) {
          previous.replace(date);
        } else {
          $getSelection()?.insertNodes([date]);
        }
      } else if (kind === 'language') {
        $setComposerCodeLanguage(text);
      } else {
        const math = $createMathNode({ source: text, isBlock: value.isBlock });
        const previous = nodeKey ? $getNodeByKey(nodeKey) : null;
        if (previous instanceof MathNode) {
          replaceFormula({ previous, replacement: math });
          return;
        }
        if (value.isBlock) {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.removeText();
          }
          $insertNodeToNearestRoot(math);
        } else {
          $getSelection()?.insertNodes([math]);
        }
      }
    });
  }

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
        <Icon size={20} />
      </button>
    );
  }

  const blockActions: ComposerMenuAction[] = [
    {
      label: 'Body text',
      applyEditorChange: () => applyEditorChange(() => $setComposerBlock('paragraph')),
    },
    ...HEADING_FORMATS.map((heading) => ({
      label: heading.label,
      applyEditorChange: () => applyEditorChange(() => $setComposerBlock(heading.tag)),
    })),
    {
      label: 'Quote',
      applyEditorChange: () => applyEditorChange(() => $setComposerBlock('quote')),
    },
    {
      label: 'Collapsible details',
      applyEditorChange: () => applyEditorChange($insertComposerDetails),
    },
    {
      label: 'Divider',
      applyEditorChange: () =>
        applyEditorChange(() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)),
    },
    {
      label: 'Clear formatting',
      applyEditorChange: () => applyEditorChange(() => $clearComposerFormatting(editor)),
    },
  ];
  const listActions: ComposerMenuAction[] = [
    {
      label: 'Numbered list',
      applyEditorChange: () =>
        applyEditorChange(() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)),
    },
    {
      label: 'Bullet list',
      applyEditorChange: () =>
        applyEditorChange(() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)),
    },
    {
      label: 'Checklist',
      applyEditorChange: () =>
        applyEditorChange(() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)),
    },
    {
      label: 'Collapsible details',
      applyEditorChange: () => applyEditorChange($insertComposerDetails),
    },
    {
      label: 'Remove list',
      applyEditorChange: () =>
        applyEditorChange(() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)),
    },
  ];
  const tableActions: ComposerMenuAction[] = [
    {
      label: 'Insert 3 × 3 table',
      isDisabled: isInTable,
      applyEditorChange: () =>
        applyEditorChange(() =>
          editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            rows: DEFAULT_TABLE_SIZE,
            columns: DEFAULT_TABLE_SIZE,
            includeHeaders: true,
          }),
        ),
    },
    {
      label: 'Add row below',
      isDisabled: !isInTable,
      applyEditorChange: () =>
        applyEditorChange(() => {
          $insertTableRowAtSelection();
        }),
    },
    {
      label: 'Add column after',
      isDisabled: !isInTable,
      applyEditorChange: () =>
        applyEditorChange(() => {
          $insertTableColumnAtSelection();
        }),
    },
    {
      label: 'Delete row',
      isDisabled: !isInTable,
      applyEditorChange: () => applyEditorChange($deleteTableRowAtSelection),
    },
    {
      label: 'Delete column',
      isDisabled: !isInTable,
      applyEditorChange: () => applyEditorChange($deleteTableColumnAtSelection),
    },
    {
      label: 'Delete table',
      isDisabled: !isInTable,
      applyEditorChange: () => applyEditorChange($removeComposerTable),
    },
  ];
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
              <Quote size={20} />
            </button>
            <span className={styles.separator} />
            <button
              className={styles.button}
              type="button"
              aria-label="Insert date"
              title="Insert date"
              onClick={() => openDialog('date')}
            >
              <CalendarDays size={20} />
            </button>
            <button
              className={styles.button}
              type="button"
              aria-label="Edit link"
              title="Edit link"
              onClick={() => openDialog('link')}
            >
              <Link size={20} />
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
              <EyeOff size={20} />
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
              <Undo2 size={22} />
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label="Redo"
              title="Redo"
              disabled={!canRedo}
              onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
            >
              <Redo2 size={22} />
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
              icon={<Plus size={23} />}
              actions={blockActions}
              {...menuProps}
            />
            <ComposerToolbarMenu
              label="Lists"
              icon={<List size={23} />}
              actions={listActions}
              {...menuProps}
            />
            <ComposerToolbarMenu
              label="Table"
              icon={<Table size={22} />}
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
              <Link size={22} />
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label="Code block"
              title="Code block"
              aria-pressed={isInCode}
              onClick={() => applyEditorChange(() => $setComposerBlock('code'))}
            >
              <CodeXml size={23} />
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label="Insert formula"
              title="Insert formula"
              onClick={() => openDialog('math')}
            >
              <Sigma size={23} />
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
