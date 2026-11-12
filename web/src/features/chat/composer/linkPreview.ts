import { useEffect, useState } from 'react';
import type { components } from '@/api/schema';
import type { EmojiText } from '@/domain/messages/customEmoji';

type LinkPreview = components['schemas']['LinkPreviewView'];

export type LoadLinkPreview = (
  url: string,
  signal: AbortSignal,
) => Promise<LinkPreview | undefined>;

const PREVIEW_DEBOUNCE_MS = 350;
const HTTP_LINK = /https?:\/\//i;
const HTTP_LINK_START = /^https?:\/\//i;
const PROSE_WORD_BOUNDARY = /[\s<>"']/;
const OPENING_WRAPPERS = /^[([{]+/;
const TRAILING_PUNCTUATION = /[,.;!。，；！？]+$/;
const LOCAL_NAME = /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/;
const IPV4_LITERAL = /^(?:\d+\.){3}\d+$/;
const LOCAL_IPV4 = /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./;
const GLOBAL_IPV6_PREFIX = /^\[[23]/;
const CLOSING_WRAPPERS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
};

interface LinkLookup {
  url?: string;
  scope?: string;
  onLoad?: LoadLinkPreview;
}

interface LinkLookupResult {
  scope?: string;
  preview: LinkPreview;
}

function isPreviewCandidate(candidate: string): boolean {
  if (!HTTP_LINK_START.test(candidate)) {
    return false;
  }

  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.port) {
      return false;
    }

    // Skip obvious local links in the editor. The server checks all destinations before fetching.
    const hostname = url.hostname.replace(/\.+$/, '');
    if (hostname.startsWith('[')) {
      return GLOBAL_IPV6_PREFIX.test(hostname);
    }
    if (IPV4_LITERAL.test(hostname)) {
      return !LOCAL_IPV4.test(hostname);
    }

    return hostname.includes('.') && !LOCAL_NAME.test(hostname);
  } catch {
    return false;
  }
}

function findPlainLink(text: string): string | undefined {
  for (const word of text.split(PROSE_WORD_BOUNDARY)) {
    const unwrapped = word.replace(OPENING_WRAPPERS, '');
    const trimmed = unwrapped.replace(TRAILING_PUNCTUATION, '');
    const closer = CLOSING_WRAPPERS[word.charAt(0)];
    const candidate = closer && trimmed.endsWith(closer) ? trimmed.slice(0, -1) : trimmed;
    if (isPreviewCandidate(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/** Find the first HTTP link in editor order without parsing markup for ordinary typing. */
export function findComposerLink({ text, richText }: EmojiText): string | undefined {
  if (!HTTP_LINK.test(text) && !HTTP_LINK.test(richText ?? '')) {
    return undefined;
  }
  if (!richText) {
    return findPlainLink(text);
  }

  // Template content is inert while we inspect the same anchor and text order as the server.
  const fragment = document.createElement('template');
  fragment.innerHTML = richText;
  const walker = document.createTreeWalker(
    fragment.content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute('href');
      if (href && isPreviewCandidate(href)) {
        return href;
      }
    }
    if (node instanceof Text && !node.parentElement?.closest('a')) {
      const candidate = findPlainLink(node.textContent ?? '');
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

/** Debounce link changes and ignore metadata returned after the composer moved on. */
export function useLinkPreview({ url, scope, onLoad }: LinkLookup): LinkPreview | undefined {
  const [result, setResult] = useState<LinkLookupResult>();
  const current =
    result?.preview.url === url && result?.scope === scope ? result?.preview : undefined;

  useEffect(() => {
    if (!url || !onLoad || current) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const preview = await onLoad(url, controller.signal);
        if (!controller.signal.aborted && preview?.url === url) {
          setResult({ scope, preview });
        }
      } catch {
        // Preview lookup is optional and never blocks composing or sending the message.
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [current, onLoad, scope, url]);

  return current;
}
