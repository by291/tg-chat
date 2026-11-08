import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';
import { useCallback, useEffect, useState } from 'react';
import {
  $getComposerCodeLanguage,
  $getComposerLink,
  $setComposerCodeLanguage,
} from '../richEditorCommands';
import {
  $createMathNode,
  $createMessageDateNode,
  MathNode,
  MessageDateNode,
} from '../nodes/richEditorNodes';
import type { ComposerDialogKind, ComposerDialogValue } from './ComposerFormatDialog';

const MILLISECONDS_PER_MINUTE = 60_000;
const DATE_TIME_INPUT_LENGTH = 16;
const ALLOWED_LINK_PROTOCOL = /^(https?:\/\/|mailto:|tel:|tg:\/\/)/i;

interface OpenDialog {
  kind: ComposerDialogKind;
  value: ComposerDialogValue;
  nodeKey?: string;
}

interface ComposerDialogsOptions {
  editor: LexicalEditor;
  captureSelection: () => void;
  applyEditorChange: (updateContent: () => void) => void;
  restoreSelection: () => void;
  onError: (message: string) => void;
}

function getCurrentDateInput(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const timezoneOffset = date.getTimezoneOffset() * MILLISECONDS_PER_MINUTE;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, DATE_TIME_INPUT_LENGTH);
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

/** Edit rich content through dialogs while keeping the original editor selection. */
export function useComposerDialogs({
  editor,
  captureSelection,
  applyEditorChange,
  restoreSelection,
  onError,
}: ComposerDialogsOptions) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

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
    const isInvalidLink =
      dialog.kind === 'link' && text !== '' && !ALLOWED_LINK_PROTOCOL.test(text);
    if (isInvalidLink) {
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

  return {
    dialog,
    openDialog,
    closeDialog,
    submitDialog,
  };
}
