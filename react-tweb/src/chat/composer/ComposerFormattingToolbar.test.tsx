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
import { RICH_EDITOR_NODES } from './richEditorNodes';

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

afterEach(cleanup);

describe('composer formatting controls', () => {
  it('formats the saved substring through the platform keyboard shortcut', async () => {
    const { editor } = renderToolbar();
    await act(async () => {
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0].select(7, 15);
        },
        { discrete: true },
      );
    });

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
    await act(async () => {
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0].select(7, 15);
        },
        { discrete: true },
      );
    });

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
});
