import {
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { useEffect } from 'react';
import { $toggleComposerSpoiler } from '../richEditorCommands';
import type { ComposerDialogKind } from './ComposerFormatDialog';

const FORMAT_SHORTCUTS: Readonly<Record<string, TextFormatType>> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strikethrough',
  m: 'code',
};

interface ComposerKeyboardShortcutsOptions {
  editor: LexicalEditor;
  openDialog: (kind: ComposerDialogKind) => void;
}

/** Apply composer shortcuts before Lexical's default keyboard commands. */
export function useComposerKeyboardShortcuts({
  editor,
  openDialog,
}: ComposerKeyboardShortcutsOptions) {
  useEffect(() => {
    return editor.registerCommand(
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
    );
  }, [editor, openDialog]);
}
