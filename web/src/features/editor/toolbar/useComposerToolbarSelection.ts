import { mergeRegister } from '@lexical/utils';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
  type RangeSelection,
  type TextFormatType,
} from 'lexical';
import { useCallback, useEffect, useRef, useState } from 'react';
import { $findSelectedAncestor, $isComposerQuoteCollapsed } from '../richEditorCommands';
import { EXTENDED_FORMATS, TEXT_FORMATS } from './composerToolbarFormats';

const TOOLBAR_GAP = 8;
const TOOLBAR_HEIGHT = 48;
const TOOLBAR_WIDTH = 584;
const MINIMUM_VIEWPORT_GUTTER = 12;

interface ToolbarPosition {
  top: number;
  left: number;
  maxWidth: number;
}

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

/** Track the editor selection and preserve it across toolbar focus changes. */
export function useComposerToolbarSelection(editor: LexicalEditor) {
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
  }, [editor]);

  return {
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
  };
}
