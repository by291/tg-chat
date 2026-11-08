interface ComposerKey {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const IME_KEY_CODE = 229;

interface SubmitOptions {
  sendShortcut?: 'enter' | 'ctrlEnter';
  isApple?: boolean;
}

/** Match the configured send chord without submitting IME composition or modified newlines. */
export function shouldSubmitMessage(
  event: ComposerKey,
  { sendShortcut = 'enter', isApple = false }: SubmitOptions = {},
): boolean {
  const isComposition = event.isComposing || event.keyCode === IME_KEY_CODE;
  if (event.key !== 'Enter' || isComposition || event.shiftKey || event.altKey) {
    return false;
  }
  if (sendShortcut === 'enter') {
    return !event.ctrlKey && !event.metaKey;
  }

  const isSendModifier = isApple ? event.metaKey : event.ctrlKey;
  const hasOtherModifier = isApple ? event.ctrlKey : event.metaKey;

  return Boolean(isSendModifier && !hasOtherModifier);
}
