import { $generateNodesFromDOM } from '@lexical/html';
import { $isListItemNode } from '@lexical/list';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import {
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { useEffect, useRef } from 'react';
import { getAppPreferences } from '@/features/settings/appPreferences';
import { isAppleKeyboard } from '@/lib/platform/keyboardPlatform';
import { shouldSubmitMessage } from './composerKeyboard';
import { parseRichEditorHtml } from './richEditorHtml';

interface EditorInputCommandsOptions {
  editor: LexicalEditor;
  onSubmit: () => void;
  onPasteImage: (file: File) => void;
}

/** Register composition-aware Enter handling and sanitized clipboard input for the editor. */
export function useEditorInputCommands({
  editor,
  onSubmit,
  onPasteImage,
}: EditorInputCommandsOptions) {
  const callbacksRef = useRef({ onSubmit, onPasteImage });
  callbacksRef.current = { onSubmit, onPasteImage };

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

        if (!event) {
          return false;
        }

        const shouldSubmit = shouldSubmitMessage(
          {
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            isComposing: editor.isComposing() || event.isComposing,
            keyCode: event.keyCode,
          },
          {
            sendShortcut: getAppPreferences().sendShortcut,
            isApple: isAppleKeyboard(),
          },
        );
        if (!shouldSubmit) {
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
}
