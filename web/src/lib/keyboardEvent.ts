const IME_KEY_CODE = 229;

/** Leave composition and legacy IME key events to the active input method. */
export function isCompositionKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>) {
  return event.isComposing || event.keyCode === IME_KEY_CODE;
}

/** Recognize an available Escape after the focused control and input method have handled it. */
export function isDismissKey(event: KeyboardEvent) {
  return event.key === 'Escape' && !event.defaultPrevented && !isCompositionKey(event);
}
