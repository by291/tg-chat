import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';

function isSupportedLink(url: string) {
  return /^(https?:|mailto:|tel:|tg:)/i.test(url);
}

/** Let the editor libraries own structural editing, list normalization, and table navigation. */
export function RichEditorPlugins() {
  return (
    <>
      <ListPlugin shouldPreserveNumbering />
      <CheckListPlugin />
      {/* Stable configuration avoids re-registering transforms on every draft update. */}
      <LinkPlugin validateUrl={isSupportedLink} />
      <TablePlugin hasCellBackgroundColor={false} hasHorizontalScroll />
      <HorizontalRulePlugin />
      <MarkdownShortcutPlugin />
    </>
  );
}
