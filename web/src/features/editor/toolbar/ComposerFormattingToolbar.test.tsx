// @vitest-environment jsdom
import { $generateHtmlFromNodes } from '@lexical/html';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerFormattingToolbar } from './ComposerFormattingToolbar';
import { $replaceEmojiEditor, $readEmojiEditor } from '../emojiEditorState';
import { $setComposerBlock } from '../richEditorCommands';
import { RICH_EDITOR_NODES } from '../nodes/richEditorNodes';

const originalRangeRectangle = Range.prototype.getBoundingClientRect;

interface EditorCaptureProps {
  onReady: (editor: LexicalEditor) => void;
}

function EditorCapture({ onReady }: EditorCaptureProps) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onReady(editor), [editor, onReady]);
  return null;
}

function renderToolbar() {
  let editor: LexicalEditor | undefined;
  const onError = vi.fn();
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'formatting-toolbar-test',
        nodes: RICH_EDITOR_NODES,
        onError: (error) => {
          throw error;
        },
        editorState: () => {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode('Before selected after'));
          $getRoot().append(paragraph);
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable aria-label="Message" />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <LinkPlugin />
      <ComposerFormattingToolbar isExpanded onError={onError} />
      <EditorCapture
        onReady={(readyEditor) => {
          editor = readyEditor;
        }}
      />
    </LexicalComposer>,
  );
  if (!editor) {
    throw new Error('The editor did not mount.');
  }

  return { editor, onError };
}

function selectSubstring(editor: LexicalEditor) {
  return act(async () => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0].select(7, 15);
      },
      { discrete: true },
    );
  });
}

afterEach(() => {
  cleanup();
  Range.prototype.getBoundingClientRect = originalRangeRectangle;
});

describe('composer formatting controls', () => {
  it('toggles whether the selected quote will be sent collapsed without changing its text', async () => {
    // JSDOM has no layout, but Lexical measures the caret when it restores focus after formatting.
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const { editor } = renderToolbar();
    await act(async () => {
      editor.update(
        () => {
          $replaceEmojiEditor({ text: 'Keep this quote' });
          $getRoot().getAllTextNodes()[0].select(0, 15);
          $setComposerBlock('quote');
        },
        { discrete: true },
      );
    });

    const toggle = screen.getByRole('button', { name: 'Send quote collapsed' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(editor.read($readEmojiEditor).richText).toContain('data-collapsed="true"');
    expect(editor.read($readEmojiEditor).text).toBe('Keep this quote');

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(editor.read($readEmojiEditor).richText).not.toContain('data-collapsed');
    expect(editor.read($readEmojiEditor).text).toBe('Keep this quote');
  });

  it('formats the saved substring through the platform keyboard shortcut', async () => {
    const { editor } = renderToolbar();
    await selectSubstring(editor);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), {
        key: 'b',
        ctrlKey: true,
      });
    });

    editor.getEditorState().read(() => {
      const boldText = $getRoot()
        .getAllTextNodes()
        .filter((node) => node.hasFormat('bold'));
      expect(boldText.map((node) => node.getTextContent()).join('')).toBe('selected');
      expect($getRoot().getTextContent()).toBe('Before selected after');
    });
  });

  it('applies a link to the original selection after typing in a dialog', async () => {
    const { editor } = renderToolbar();
    await selectSubstring(editor);

    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    const urlInput = await screen.findByLabelText('URL');
    fireEvent.change(urlInput, { target: { value: 'https://example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    });

    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('a')?.textContent).toBe('selected');
    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(document.body.textContent).toBe('Before selected after');
  });
  it('keeps an invalid link dialog open without modifying the selected text', async () => {
    const { editor, onError } = renderToolbar();
    await selectSubstring(editor);

    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    const urlInput = await screen.findByLabelText('URL');
    fireEvent.change(urlInput, { target: { value: 'javascript:alert(1)' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    });

    expect(onError).toHaveBeenCalledWith(
      'Enter a valid https, http, mailto, tel, or Telegram link.',
    );
    expect(screen.getByLabelText('URL')).toBe(urlInput);
    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.textContent).toBe('Before selected after');
  });

  it('returns focus without inserting a link when a keyboard-opened dialog is cancelled', async () => {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const { editor } = renderToolbar();
    await selectSubstring(editor);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), {
        key: 'k',
        ctrlKey: true,
      });
    });
    const urlInput = await screen.findByLabelText('URL');
    fireEvent.change(urlInput, { target: { value: 'https://example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    expect(parsedDocument.querySelector('a')).toBeNull();
  });
});
