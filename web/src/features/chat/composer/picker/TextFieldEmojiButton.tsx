import { EmojiPicker } from './EmojiPicker';

interface TextFieldEmojiButtonProps {
  label: string;
  getInput: () => HTMLInputElement | HTMLTextAreaElement | null | undefined;
  onChange: (value: string) => void;
}

/** Insert Unicode emoji at the saved input selection without replacing the field's draft. */
export function TextFieldEmojiButton({ label, getInput, onChange }: TextFieldEmojiButtonProps) {
  function insertEmoji(emoji: string) {
    const input = getInput();
    if (!input) {
      return;
    }

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const nextValue = input.value.slice(0, start) + emoji + input.value.slice(end);
    if (input.maxLength >= 0 && nextValue.length > input.maxLength) {
      return;
    }

    onChange(nextValue);
    // Controlled inputs must receive the new text before restoring the insertion caret.
    requestAnimationFrame(() => {
      if (!input.isConnected) {
        return;
      }

      input.focus();
      const caret = start + emoji.length;
      input.setSelectionRange(caret, caret);
    });
  }

  return <EmojiPicker variant="field" label={label} onSelectEmoji={insertEmoji} />;
}
