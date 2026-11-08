import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  INSERT_TABLE_COMMAND,
} from '@lexical/table';
import type { LexicalEditor } from 'lexical';
import {
  $clearComposerFormatting,
  $insertComposerDetails,
  $removeComposerTable,
  $setComposerBlock,
} from '../richEditorCommands';
import type { ComposerMenuAction } from './ComposerToolbarMenu';

const DEFAULT_TABLE_SIZE = '3';
const HEADING_FORMATS = [
  { tag: 'h1', label: 'Heading 1' },
  { tag: 'h2', label: 'Heading 2' },
  { tag: 'h3', label: 'Heading 3' },
  { tag: 'h4', label: 'Heading 4' },
  { tag: 'h5', label: 'Heading 5' },
  { tag: 'h6', label: 'Heading 6' },
] as const;

interface ComposerToolbarActionsOptions {
  editor: LexicalEditor;
  applyEditorChange: (updateContent: () => void) => void;
  isInTable: boolean;
}

/** Build the block, list, and table commands offered by the expanded toolbar. */
export function createComposerToolbarActions({
  editor,
  applyEditorChange,
  isInTable,
}: ComposerToolbarActionsOptions) {
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

  return {
    blockActions,
    listActions,
    tableActions,
  };
}
