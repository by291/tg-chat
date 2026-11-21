import { isCompositionKey } from '@/lib/keyboardEvent';

interface ComposerKey {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

interface SubmitOptions {
  sendShortcut?: 'enter' | 'ctrlEnter';
  isApple?: boolean;
}

/** Match the configured send chord without submitting IME composition or modified newlines. */
export function shouldSubmitMessage(
  event: ComposerKey,
  { sendShortcut = 'enter', isApple = false }: SubmitOptions = {},
): boolean {
  const isComposition = isCompositionKey(event);
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
