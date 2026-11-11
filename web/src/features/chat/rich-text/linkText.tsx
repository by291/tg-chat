import type { ReactNode } from 'react';

const HTTP_LINK = /\bhttps?:\/\/[^\s<>"']+/gi;
const PROSE_WRAPPERS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/** Turn ordinary HTTP links into safe anchors while keeping surrounding prose intact. */
export function linkText(text: string): ReactNode[] | undefined {
  const parts: ReactNode[] = [];
  let offset = 0;

  for (const match of text.matchAll(HTTP_LINK)) {
    const closingWrapper = PROSE_WRAPPERS.get(text[match.index - 1]);
    let url = match[0].replace(/[.,!;。，；！？]+$/, '');
    if (closingWrapper && url.endsWith(closingWrapper)) {
      url = url.slice(0, -1);
    }
    if (!URL.canParse(url)) {
      continue;
    }

    parts.push(text.slice(offset, match.index));
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    offset = match.index + url.length;
  }

  if (!offset) {
    return undefined;
  }

  parts.push(text.slice(offset));
  return parts;
}
