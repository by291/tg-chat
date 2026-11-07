// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RichMessageText } from './RichMessageText';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('rich message content', () => {
  it('copies code with its original line breaks', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<RichMessageText richText="<pre>const first = 1;<br>const second = 2;</pre>" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('const first = 1;\nconst second = 2;');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('expands and collapses a saved collapsible quote without losing its text', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 120,
    });
    try {
      render(
        <RichMessageText richText='<blockquote data-collapsed="true">First<br>Second<br>Third<br>Fourth</blockquote>' />,
      );
      const expand = screen.getByRole('button', { name: 'Expand quote' });
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(expand);
      const collapse = screen.getByRole('button', { name: 'Collapse quote' });
      expect(collapse.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText(/Fourth/)).toBeTruthy();
      fireEvent.click(collapse);
      expect(
        screen.getByRole('button', { name: 'Expand quote' }).getAttribute('aria-expanded'),
      ).toBe('false');
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
      }
    }
  });

  it('renders semantic blocks and opens links without granting access to the message window', () => {
    const { container } = render(
      <RichMessageText
        richText={
          '<h2>Agenda</h2><p><strong>Read</strong> <a href="https://example.com">More</a></p>' +
          '<table><tbody><tr><td>Details</td></tr></tbody></table>'
        }
      />,
    );

    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('Read');
    expect(screen.getByRole('link', { name: 'More' }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    expect(screen.getByRole('table').textContent).toBe('Details');
  });

  it('reveals spoiler text only after activating its control', () => {
    render(<RichMessageText richText='<p>A <span data-spoiler="true">secret</span></p>' />);
    const spoiler = screen.getByRole('button', { name: 'Reveal spoiler' });
    expect(spoiler.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(spoiler);

    expect(spoiler.getAttribute('aria-expanded')).toBe('true');
    expect(spoiler.textContent).toBe('secret');
  });

  it('shows saved task states without pretending that read-only tasks can be toggled', () => {
    render(
      <RichMessageText
        richText={
          '<ul data-list-type="check">' +
          '<li aria-checked="true">Read the notes</li>' +
          '<li aria-checked="false">Write a reply</li></ul>'
        }
      />,
    );
    const completedTask = screen.getByRole('checkbox', { name: 'Read the notes' });
    const pendingTask = screen.getByRole('checkbox', { name: 'Write a reply' });

    expect(completedTask.getAttribute('aria-checked')).toBe('true');
    expect(pendingTask.getAttribute('aria-checked')).toBe('false');
    expect(pendingTask.getAttribute('aria-readonly')).toBe('true');

    fireEvent.click(pendingTask);

    expect(pendingTask.getAttribute('aria-checked')).toBe('false');
  });

  it('renders formulas without enabling trusted HTML or unsafe command links', () => {
    const { container } = render(
      <RichMessageText
        richText={
          '<span data-math="x^2" data-math-display="inline">x²</span>' +
          '<span data-math="\\href{javascript:alert(1)}{Click}">Unsafe formula</span>'
        }
      />,
    );

    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('retains readable emoji fallbacks and formats saved dates', () => {
    const { container } = render(
      <RichMessageText
        richText={
          '<span data-custom-emoji="999999999999">😂</span>' +
          '<time data-message-date="1800000000000">Event</time>'
        }
      />,
    );

    expect(container.textContent).toContain('😂');
    expect(container.querySelector('time')?.dateTime).toBe('2027-01-15T08:00:00.000Z');
  });
});
