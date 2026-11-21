import { useLayoutEffect, useRef, useState } from 'react';
import { useExitingSidebarPage } from '@/layouts/sidebar/useExitingSidebarPage';
import type { ChatOwner } from '../data/ChatOwner';

type InformationTarget = { kind: 'peer' | 'community'; id: string };

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
  canDisplay: (target: InformationTarget) => boolean;
}) {
  const { scope, canDisplay } = options;
  const [selection, setSelection] = useState<InformationSelection>();
  const retained = useExitingSidebarPage(selection);
  const trigger = useRef<HTMLElement | null>(null);
  const shouldRestoreFocus = useRef(false);
  const ownsSelection =
    retained?.owner === scope.owner &&
    retained.destination === scope.destination &&
    retained.generation === scope.generation &&
    canDisplay(retained.target);
  const target = ownsSelection ? retained.target : undefined;
  const isOpen = Boolean(selection && target);

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
    if (target && button?.isConnected && !button.closest('[inert], [hidden]')) {
      button.focus({ preventScroll: true });
    }
  }, [selection, target, isOpen]);

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
