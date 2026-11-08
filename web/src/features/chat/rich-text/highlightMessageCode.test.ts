// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { highlightMessageCode } from './highlightMessageCode';

function readHighlight(html: string) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('message code highlighting', () => {
  it('detects unlabelled JavaScript and retains the original characters and newlines', async () => {
    const source = 'const element = "<script>alert(1)</script>";\n  console.log(element);';
    const highlighted = await highlightMessageCode({ source });
    expect(highlighted?.language).toBe('javascript');
    const content = readHighlight(highlighted?.html ?? '');
    expect(content.textContent).toBe(source);
    expect(content.querySelector('script')).toBeNull();
    expect(content.querySelector('.token.keyword')?.textContent).toBe('const');
  });

  it('loads dependent grammars when concurrent messages specify language aliases', async () => {
    const source = 'const count: number = 42;';
    const messages = await Promise.all([
      highlightMessageCode({ source, language: 'ts' }),
      highlightMessageCode({ source, language: 'typescript' }),
    ]);
    for (const highlighted of messages) {
      expect(highlighted?.language).toBe('typescript');
      expect(readHighlight(highlighted?.html ?? '').textContent).toBe(source);
    }
  });

  it('leaves explicitly unknown languages unhighlighted instead of guessing another language', async () => {
    const highlighted = await highlightMessageCode({
      source: 'const amount = 42;',
      language: 'not-a-real-language',
    });
    expect(highlighted).toBeUndefined();
  });
});
