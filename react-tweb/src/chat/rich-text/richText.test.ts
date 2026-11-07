// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { sanitizeRichText } from './richText';

describe('rich message sanitizing', () => {
  it('discards blank editor paragraphs while retaining meaningful structural content', () => {
    expect(sanitizeRichText('<p><br></p>')).toBe('');
    expect(sanitizeRichText('<hr>')).toBe('<hr>');
    expect(sanitizeRichText('<table><tbody><tr><td></td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td></td></tr></tbody></table>',
    );
  });

  it('removes executable markup, unsafe links, and arbitrary presentation attributes', () => {
    const unsafe = [
      '<script>alert(1)</script><iframe src="https://example.com"></iframe>',
      '<p onclick="alert(1)" style="color:red" id="location" data-other="unsafe">',
      '<a href="javascript:alert(1)" target="_self">Unsafe</a>',
      '<img src="x" onerror="alert(1)">',
      '<a href="https://example.com/path">Safe</a></p>',
    ].join('');

    expect(sanitizeRichText(unsafe)).toBe(
      '<p><a>Unsafe</a><a href="https://example.com/path">Safe</a></p>',
    );
  });

  it('retains semantic marks, structured blocks, and custom content across repeated sanitizing', () => {
    const richText = [
      '<h2>Heading</h2><p><strong>Bold</strong><em>Italic</em><u>Underlined</u>',
      '<s>Removed</s><mark>Highlighted</mark><sub>2</sub><sup>3</sup>',
      '<span data-spoiler="true">Secret</span>',
      '<span data-custom-emoji="5249007745805328497">😂</span>',
      '<span data-math="x^2" data-math-display="inline">x²</span>',
      '<time data-message-date="1800000000000" datetime="2027-01-15">Date</time></p>',
      '<blockquote>Quote</blockquote><pre data-code-language="typescript"><code>let value = 1;</code></pre>',
      '<ul data-list-type="check"><li data-checked="true">Done</li></ul>',
      '<ol start="3"><li>Third</li></ol>',
      '<table><tbody><tr><th>Title</th><td colspan="2">Cell</td></tr></tbody></table>',
      '<details><summary>More</summary><p>Hidden</p></details><hr>',
    ].join('');

    expect(sanitizeRichText(richText)).toBe(richText);
    expect(sanitizeRichText(sanitizeRichText(richText))).toBe(richText);
  });

  it('normalizes Telegram collapsed quote markers while rejecting malformed values', () => {
    expect(sanitizeRichText('<blockquote data-collapsed>Quoted text</blockquote>')).toBe(
      '<blockquote data-collapsed="true">Quoted text</blockquote>',
    );
    expect(sanitizeRichText('<blockquote data-collapsed="1">Quoted text</blockquote>')).toBe(
      '<blockquote data-collapsed="true">Quoted text</blockquote>',
    );
    expect(sanitizeRichText('<blockquote data-collapsed="false">Quoted text</blockquote>')).toBe(
      '<blockquote data-collapsed="false">Quoted text</blockquote>',
    );
    expect(sanitizeRichText('<blockquote data-collapsed="anything">Quoted text</blockquote>')).toBe(
      '<blockquote>Quoted text</blockquote>',
    );
  });

  it('rejects malformed custom metadata while keeping readable content', () => {
    const unsafe = [
      '<span data-custom-emoji="javascript:alert(1)" data-spoiler="wrong">Emoji</span>',
      '<time data-message-date="Infinity">Date</time>',
      '<span data-math="x" data-math-display="unknown">Formula</span>',
      '<ul data-list-type="wrong"><li aria-checked="mixed">Task</li></ul>',
    ].join('');

    expect(sanitizeRichText(unsafe)).toBe(
      '<span>Emoji</span><time>Date</time><span data-math="x">Formula</span>' +
        '<ul><li>Task</li></ul>',
    );
  });
});
