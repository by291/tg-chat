import type { EditorThemeClasses } from 'lexical';
import styles from './RichEditorTheme.module.css';

export const RICH_EDITOR_THEME: EditorThemeClasses = {
  text: {
    bold: styles.bold,
    italic: styles.italic,
    underline: styles.underline,
    strikethrough: styles.strikethrough,
    underlineStrikethrough: styles.underlineStrikethrough,
    code: styles.inlineCode,
    highlight: styles.highlight,
    subscript: styles.subscript,
    superscript: styles.superscript,
  },
  quote: styles.quote,
  code: styles.code,
  link: styles.link,
  list: {
    ul: styles.unorderedList,
    ol: styles.orderedList,
    listitem: styles.listItem,
    listitemChecked: styles.checkedItem,
    listitemUnchecked: styles.uncheckedItem,
    nested: { listitem: styles.nestedItem },
  },
  table: styles.table,
  tableScrollableWrapper: styles.tableScroll,
  tableCell: styles.tableCell,
  tableCellHeader: styles.tableCellHeader,
  tableCellSelected: styles.tableCellSelected,
};
