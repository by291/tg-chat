import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useExitingSidebarPage } from '@/layouts/sidebar/useExitingSidebarPage';
import type { ChatOwner } from '../data/ChatOwner';

type InformationTarget = { kind: 'peer' | 'community' | 'poll'; id: string };

interface InformationScope {
  owner: ChatOwner;
  destination: string;
  generation?: string;
}

interface InformationSelection extends InformationScope {
  target: InformationTarget;
}

/** Keep the exiting panel mounted only while its original session and membership still own it. */
export function useConversationInformation(options: {
  scope: InformationScope;
  fallbackFocus: RefObject<HTMLElement | null>;
  canDisplay: (target: InformationTarget) => boolean;
}) {
  const { scope, canDisplay, fallbackFocus } = options;
  const [selection, setSelection] = useState<InformationSelection>();
  const trigger = useRef<HTMLElement | null>(null);
  const shouldRestoreFocus = useRef(false);

  function isSelectionOwned(candidate: InformationSelection) {
    return (
      candidate.owner === scope.owner &&
      candidate.destination === scope.destination &&
      candidate.generation === scope.generation &&
      canDisplay(candidate.target)
    );
  }

  const retained = useExitingSidebarPage(selection, isSelectionOwned);
  const target = retained?.target;
  const isOpen = Boolean(selection && target);

  // prettier-ignore
  useLayoutEffect(() => {
    // Clearing invalid selections prevents a later re-admission from reopening the old panel.
    if (selection && !target) {
      setSelection(undefined);
    }
    if (isOpen || !shouldRestoreFocus.current) {
      return;
    }
    shouldRestoreFocus.current = false;
    const button = trigger.current;
    if (!target) {
      return;
    }
    // A virtualized poll can lose its original button while the sidebar is open.
    const canFocusButton = button?.isConnected && !button.closest('[inert], [hidden]');
    const destination = canFocusButton ? button : fallbackFocus.current;
    destination?.focus({ preventScroll: true });
  }, [
    selection,
    target,
    isOpen,
    fallbackFocus,
  ]);

  function open(nextTarget: InformationTarget, opener: HTMLElement | null) {
    trigger.current = opener;
    setSelection({ ...scope, target: nextTarget });
  }

  function close() {
    shouldRestoreFocus.current = true;
    setSelection(undefined);
  }

  // prettier-ignore
  return {
    target,
    isOpen,
    open,
    close,
  };
}
