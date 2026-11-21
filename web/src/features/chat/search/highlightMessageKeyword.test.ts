// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { highlightMessageKeyword } from './highlightMessageKeyword';

afterEach(() => vi.unstubAllGlobals());

it('matches composed search text across formatting in a decomposed message', () => {
  const highlights = new Map<string, Set<Range>>();
  vi.stubGlobal('CSS', { highlights });
  vi.stubGlobal('Highlight', Set);
  const row = document.createElement('article');
  row.innerHTML = '<div data-message-text>A <b>Caf</b>e\u0301 today</div>';
  const dispose = highlightMessageKeyword(row, 'café');
  const result = highlights.get('message-search-keyword');
  expect(Array.from(result ?? [], (range) => range.toString())).toEqual(['Cafe\u0301']);
  expect(row.querySelector('b')?.textContent).toBe('Caf');

  dispose?.();
  expect(highlights.size).toBe(0);
});
