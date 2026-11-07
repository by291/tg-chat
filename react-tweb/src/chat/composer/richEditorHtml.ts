import { $generateHtmlFromNodes } from '@lexical/html';
import { $getEditor } from 'lexical';
import { sanitizeRichText } from '../rich-text/richText';

/** Restore the library's import hints from the portable message attributes. */
export function parseRichEditorHtml(html: string): Document {
  const document = new DOMParser().parseFromString(sanitizeRichText(html), 'text/html');
  for (const code of document.querySelectorAll('pre[data-code-language]')) {
    code.setAttribute('data-language', code.getAttribute('data-code-language') ?? '');
  }
  for (const list of document.querySelectorAll('ul[data-list-type="check"]')) {
    list.setAttribute('__lexicallisttype', 'check');
  }
  return document;
}

/** Export semantic message HTML without storing editor-specific attributes or class names. */
export function $exportRichEditorHtml(): string {
  const html = $generateHtmlFromNodes($getEditor());
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const code of document.querySelectorAll('pre[data-language]')) {
    code.setAttribute('data-code-language', code.getAttribute('data-language') ?? '');
  }
  for (const list of document.querySelectorAll('ul[__lexicallisttype="check"]')) {
    list.setAttribute('data-list-type', 'check');
  }
  return sanitizeRichText(document.body.innerHTML);
}
