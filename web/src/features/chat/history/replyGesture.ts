import { findMessageRow } from '../messages/selection/messageRowTarget';

export const REPLY_DISTANCE = 48;
export const MAX_SWIPE_DISTANCE = 64;
const NATIVE_CONTROL =
  'button:not([data-photo-id]), a, input, select, textarea, [role="button"], [role="slider"], video[controls], audio, pre, table, [contenteditable="true"], [data-message-metadata]';

export interface ReplyGesture {
  row: HTMLElement;
  messageId: string;
  avatar?: HTMLElement;
  direction: number;
  distance: number;
  isActive: boolean;
}

/** Leave controls, text selection and the gallery's double-click behavior to their owners. */
export function canReplyFromTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && !target.closest(NATIVE_CONTROL) && !hasSelectedText();
}

function hasSelectedText() {
  return Boolean(window.getSelection()?.toString().trim());
}

function findVisibleAvatar(row: HTMLElement) {
  const group = row.dataset.replyGroup;
  const history = row.closest('[data-history-rows]');
  if (!group || !history) {
    return;
  }

  const selector = `[data-sender-group="${CSS.escape(group)}"] > :first-child`;
  const avatar = history.querySelector<HTMLElement>(selector);
  const avatarBounds = avatar?.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  if (avatarBounds && avatarBounds.top < bounds.bottom && avatarBounds.bottom > bounds.top) {
    return avatar ?? undefined;
  }
}

/** Resolve a repliable text or gallery surface without changing it on a plain tap. */
export function prepareReplyGesture(target: EventTarget | null): ReplyGesture | undefined {
  if (!canReplyFromTarget(target) || !target.closest('[data-message-text], [data-photo-id]')) {
    return;
  }
  const row = findMessageRow(target);
  const messageId = row?.dataset.messageId;
  if (!row?.hasAttribute('data-can-swipe-reply') || !messageId) {
    return;
  }
  return {
    row,
    messageId,
    avatar: findVisibleAvatar(row),
    direction: getComputedStyle(row).direction === 'rtl' ? 1 : -1,
    distance: 0,
    isActive: false,
  };
}

/** Move the bubble and its overlapping sticky avatar within the same capped drag. */
export function moveReplyGesture(gesture: ReplyGesture, distance: number) {
  const offset = Math.max(0, Math.min(distance, MAX_SWIPE_DISTANCE));
  gesture.distance = offset;
  gesture.isActive = true;
  const shift = `${offset * gesture.direction}px`;
  gesture.row.dataset.replySwiping = 'true';
  if (offset >= REPLY_DISTANCE) {
    gesture.row.dataset.replyReady = 'true';
  }
  gesture.row.style.setProperty(
    '--reply-swipe-opacity',
    String(Math.min(offset / REPLY_DISTANCE, 1)),
  );
  gesture.row.style.setProperty('--reply-swipe-offset', shift);
  if (gesture.avatar) {
    gesture.avatar.dataset.replySwiping = 'true';
    gesture.avatar.style.setProperty('--reply-swipe-offset', shift);
  }
}

/** Release visual offsets before dispatching a still-authorized reply to the composer. */
export function finishReplyGesture(gesture: ReplyGesture, onReply?: (id: string) => void) {
  if (!gesture.isActive) {
    return;
  }

  const { row, avatar } = gesture;
  delete row.dataset.replySwiping;
  row.removeAttribute('data-reply-ready');
  row.style.removeProperty('--reply-swipe-opacity');
  row.style.removeProperty('--reply-swipe-offset');
  if (avatar) {
    delete avatar.dataset.replySwiping;
    avatar.style.removeProperty('--reply-swipe-offset');
  }

  const isCurrent = row.isConnected && row.dataset.messageId === gesture.messageId;
  const canReply = isCurrent && row.hasAttribute('data-can-swipe-reply') && !hasSelectedText();
  if (canReply && gesture.distance >= REPLY_DISTANCE) {
    onReply?.(gesture.messageId);
  }
}
