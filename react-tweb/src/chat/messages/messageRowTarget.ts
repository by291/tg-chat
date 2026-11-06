/** Resolve the full-width message row shared by menus, selection and reply gestures. */
export function findMessageRow(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLElement>('[data-message-id]');
}
