interface ComposerKey {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

const IME_KEY_CODE = 229;

/** Submit only an unmodified Enter outside an active input-method composition. */
export function shouldSubmitMessage(event: ComposerKey): boolean {
  const isComposition = event.isComposing || event.keyCode === IME_KEY_CODE;
  return event.key === 'Enter' && !event.shiftKey && !isComposition;
}
