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
    expect(
      shouldSubmitMessage({
        ...keyboard,
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });
});

it('uses the platform modifier for configured sending and preserves plain Enter for a newline', () => {
  const keyboard = {
    key: 'Enter',
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
  };
  const appleOptions = { sendShortcut: 'ctrlEnter', isApple: true } as const;
  const otherOptions = { sendShortcut: 'ctrlEnter', isApple: false } as const;

  expect(shouldSubmitMessage(keyboard, appleOptions)).toBe(false);
  expect(shouldSubmitMessage({ ...keyboard, metaKey: true }, appleOptions)).toBe(true);
  expect(shouldSubmitMessage({ ...keyboard, ctrlKey: true }, appleOptions)).toBe(false);
  expect(shouldSubmitMessage({ ...keyboard, ctrlKey: true }, otherOptions)).toBe(true);
  expect(shouldSubmitMessage({ ...keyboard, metaKey: true }, otherOptions)).toBe(false);
  expect(
    shouldSubmitMessage(
      {
        ...keyboard,
        metaKey: true,
        shiftKey: true,
      },
      appleOptions,
    ),
  ).toBe(false);
  expect(
    shouldSubmitMessage(
      {
        ...keyboard,
        metaKey: true,
        isComposing: true,
      },
      appleOptions,
    ),
  ).toBe(false);
  expect(
    shouldSubmitMessage(
      {
        ...keyboard,
        ctrlKey: true,
        keyCode: 229,
      },
      otherOptions,
    ),
  ).toBe(false);
  expect(shouldSubmitMessage({ ...keyboard, altKey: true })).toBe(false);
});
