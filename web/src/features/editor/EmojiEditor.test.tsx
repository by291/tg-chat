// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmojiText } from '@/domain/messages/customEmoji';
import { EmojiEditor, type EmojiEditorControls } from './EmojiEditor';

afterEach(cleanup);

it('inserts into a replacement draft without restoring the previous draft or caret', async () => {
  const controlsRef = createRef<EmojiEditorControls>();
  const onChange = vi.fn();
  const onError = vi.fn();

  function renderEditor(value: EmojiText) {
    return (
      <EmojiEditor
        value={value}
        controlsRef={controlsRef}
        placeholder="Write a message"
        onChange={onChange}
        onSubmit={() => {}}
        onCancel={() => {}}
        onPasteImage={() => {}}
        onError={onError}
      />
    );
  }

  const { rerender } = render(renderEditor({ text: 'Old draft' }));
  const editable = screen.getByRole('textbox', { name: 'Message' });
  await act(async () => {
    controlsRef.current?.insertEmoji('!');
  });
  expect(editable.textContent).toBe('Old draft!');

  onChange.mockClear();
  rerender(renderEditor({ text: 'Replacement draft' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(editable);
  expect(editable.textContent).toBe('Replacement draft');
  expect(onChange).not.toHaveBeenCalled();

  await act(async () => {
    controlsRef.current?.insertEmoji('?');
  });
  expect(editable.textContent).toBe('Replacement draft?');
  expect(onChange).toHaveBeenLastCalledWith({ text: 'Replacement draft?', customEmoji: [] });
  expect(onError).not.toHaveBeenCalled();
});
