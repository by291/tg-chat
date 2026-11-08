import { useEffect, type RefObject } from 'react';
import type { SettingsSearchItem } from './settingsSearch';
import styles from './SettingsSearchPanel.module.css';

const TARGET_SCROLL_MARGIN = 12;

function findSearchTarget(root: HTMLElement, label: string, scope?: string) {
  const sections = Array.from(root.querySelectorAll<HTMLElement>('section[aria-label]'));
  const section = sections.find((element) => element.getAttribute('aria-label') === scope);
  const searchRoot = section ?? root;
  const candidates = searchRoot.querySelectorAll<HTMLElement>(
    '[data-settings-label], h2, h3, legend, button',
  );

  return Array.from(candidates).find((element) => {
    if (element.closest('[inert]')) {
      return false;
    }

    return element.dataset.settingsLabel === label || element.textContent?.trim() === label;
  });
}

function scrollToTarget(root: HTMLElement, target: HTMLElement) {
  let container = target.parentElement;
  while (container && root.contains(container)) {
    if (getComputedStyle(container).overflowY === 'auto') {
      const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      // Scroll only the owning vertical panel; scrollIntoView can shift offscreen sidebar layers.
      container.scrollTo?.({ top: container.scrollTop + offset - TARGET_SCROLL_MARGIN });
      return;
    }

    container = container.parentElement;
  }
}

/** Locate and briefly highlight the selected setting after its destination mounts. */
export function useSettingsSearchTarget({
  rootRef,
  item,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  item?: SettingsSearchItem;
}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !item?.anchor) {
      return;
    }

    const target = findSearchTarget(root, item.anchor, item.scope);
    if (!target) {
      return;
    }

    scrollToTarget(root, target);
    target.classList.add(styles.highlight);

    return () => target.classList.remove(styles.highlight);
  }, [rootRef, item]);
}
