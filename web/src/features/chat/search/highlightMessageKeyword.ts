const SEARCH_HIGHLIGHT = 'message-search-keyword';
const TEXT_CONTAINER = '[data-message-text]';
const EXCLUDED_TEXT = '[data-message-metadata], [inert], [aria-hidden="true"], button';

function originalMatch(text: string, pattern: RegExp) {
  const normalized = text.normalize('NFC');
  const match = pattern.exec(normalized);
  if (!match) {
    return;
  }
  const end = match.index + match[0].length;
  if (normalized === text) {
    return { start: match.index, end };
  }

  // The server matches NFC. A composed character may occupy several original DOM offsets.
  const segments = new Intl.Segmenter().segment(text);
  let start = 0;
  let offset = 0;
  for (const { segment, index } of segments) {
    const length = segment.normalize('NFC').length;
    const next = offset + length;
    const hasSameLength = length === segment.length;
    if (offset <= match.index && match.index < next) {
      start = hasSameLength ? index + match.index - offset : index;
    }
    if (end <= next) {
      const finish = hasSameLength ? index + end - offset : index + segment.length;
      return { start, end: finish };
    }
    offset = next;
  }
}

function findMatch(container: Element, pattern: RegExp) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; start: number; end: number }[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(EXCLUDED_TEXT)) {
      continue;
    }

    const start = text.length;
    text += node.textContent;
    nodes.push({
      node,
      start,
      end: text.length,
    });
  }

  const match = originalMatch(text, pattern);
  if (!match) {
    return;
  }
  const { start, end } = match;
  const first = nodes.find((entry) => entry.end > start);
  const last = nodes.find((entry) => entry.end >= end);
  if (first && last) {
    const range = new Range();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }
}

/** Paint the first literal match across rich text nodes without changing links or selection. */
export function highlightMessageKeyword(row: HTMLElement, keyword: string) {
  if (!globalThis.CSS?.highlights || !keyword) {
    return;
  }

  const escaped = keyword.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'iu');
  for (const container of row.querySelectorAll(TEXT_CONTAINER)) {
    const range = findMatch(container, pattern);
    if (range) {
      // Multiple mounted histories can highlight at once. Each row releases just its own range.
      const highlight = CSS.highlights.get(SEARCH_HIGHLIGHT) ?? new Highlight();
      highlight.add(range);
      CSS.highlights.set(SEARCH_HIGHLIGHT, highlight);
      return () => {
        highlight.delete(range);
        if (!highlight.size) {
          CSS.highlights.delete(SEARCH_HIGHLIGHT);
        }
      };
    }
  }
}
