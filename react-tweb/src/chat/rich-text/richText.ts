import DOMPurify from 'dompurify';

const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;
const MAX_TABLE_SPAN = 100;
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'code',
  'pre',
  'blockquote',
  'a',
  'mark',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'details',
  'summary',
  'span',
  'time',
];
const ALLOWED_ATTRIBUTES = [
  'data-custom-emoji',
  'data-spoiler',
  'data-math',
  'data-math-display',
  'data-message-date',
  'data-code-language',
  'data-collapsed',
  'data-list-type',
  'data-checked',
  'aria-checked',
  'href',
  'datetime',
  'start',
  'value',
  'colspan',
  'rowspan',
];

function isSafeAttribute(element: Element, attribute: Attr): boolean {
  const { name, value } = attribute;
  const tag = element.localName;
  const isBoolean = value === 'true' || value === 'false';

  switch (name) {
    case 'href':
      return tag === 'a' && /^(https?:|mailto:|tel:|tg:|\/[^/]|#)/i.test(value);
    case 'data-custom-emoji':
      return tag === 'span' && /^\d+$/.test(value);
    case 'data-spoiler':
      return tag === 'span' && value === 'true';
    case 'data-math':
      return tag === 'span' && value.length > 0;
    case 'data-math-display':
      return tag === 'span' && (value === 'block' || value === 'inline');
    case 'data-message-date': {
      const timestamp = Number(value);
      const isValidTimestamp =
        Number.isFinite(timestamp) && Math.abs(timestamp) <= MAX_DATE_TIMESTAMP;
      return (tag === 'time' || tag === 'span') && value.trim().length > 0 && isValidTimestamp;
    }
    case 'datetime':
      return tag === 'time' && Number.isFinite(Date.parse(value));
    case 'data-collapsed':
      return tag === 'blockquote' && isBoolean;
    case 'data-code-language':
      return (tag === 'pre' || tag === 'code') && /^[\w+#.-]+$/.test(value);
    case 'data-list-type':
      return tag === 'ul' && value === 'check';
    case 'data-checked':
    case 'aria-checked':
      return tag === 'li' && isBoolean;
    case 'start':
      return tag === 'ol' && /^-?\d+$/.test(value);
    case 'value':
      return tag === 'li' && /^-?\d+$/.test(value);
    case 'colspan':
    case 'rowspan': {
      const span = Number(value);
      const isValidSpan = Number.isInteger(span) && span > 0 && span <= MAX_TABLE_SPAN;
      return (tag === 'td' || tag === 'th') && isValidSpan;
    }
    default:
      return false;
  }
}

function normalizeQuotePresentation(fragment: DocumentFragment) {
  for (const quote of fragment.querySelectorAll('blockquote[data-collapsed]')) {
    const marker = quote.getAttribute('data-collapsed');
    if (marker === '' || marker === '1') {
      quote.setAttribute('data-collapsed', 'true');
    }
  }
}

/** Keep only supported semantic message content before storing or rendering it. */
export function sanitizeRichText(html: string): string {
  if (!html || !DOMPurify.isSupported) {
    return '';
  }

  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });

  normalizeQuotePresentation(fragment);
  for (const element of fragment.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (!isSafeAttribute(element, attribute)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const hasText = Boolean(fragment.textContent?.trim());
  const hasStructure = Boolean(
    fragment.querySelector('hr, table, [data-math], [data-message-date]'),
  );
  if (!hasText && !hasStructure) {
    return '';
  }

  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
