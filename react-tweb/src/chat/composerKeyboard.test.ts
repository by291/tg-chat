import { describe, expect, it } from 'vitest';
import { shouldSubmitMessage } from './composerKeyboard';

describe('composer submission', () => {
  it('submits plain Enter and preserves Shift+Enter for a newline', () => {
    const keyboard = {
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
    };

    expect(shouldSubmitMessage(keyboard)).toBe(true);
    expect(shouldSubmitMessage({ ...keyboard, shiftKey: true })).toBe(false);
  });

  it('does not submit while choosing a character with an input method', () => {
    const keyboard = {
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      keyCode: 13,
    };

    expect(shouldSubmitMessage(keyboard)).toBe(false);
    expect(shouldSubmitMessage({ ...keyboard, isComposing: false, keyCode: 229 })).toBe(false);
  });
});
