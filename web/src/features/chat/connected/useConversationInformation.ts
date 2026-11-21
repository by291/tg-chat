import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useExitingSidebarPage } from '@/layouts/sidebar/useExitingSidebarPage';
import { useHandheldPanel, type PanelEntry } from './HandheldPanelHistory';
import type { ChatOwner } from '../data/ChatOwner';

export interface VoterTarget {
  id: string;
  optionId: string;
  after?: string;
  version: string;
}

type InformationTarget = { kind: 'peer' | 'community' | 'poll'; id: string };

interface InformationScope {
  owner: ChatOwner;
  destination: string;
  generation?: string;
}

interface InformationSelection extends InformationScope {
  voterEntry: RefObject<PanelEntry<VoterTarget> | undefined>;
  target: InformationTarget;
}

function restoredTrigger(container: HTMLElement | null, target: InformationTarget) {
  if (!container || target.kind !== 'poll') {
    return container;
  }
  // Back may have unmounted and then recreated this exact virtual row.
  const rows = container.querySelectorAll<HTMLElement>('[data-message-id]');
  const row = Array.from(rows).find((candidate) => candidate.dataset.messageId === target.id);
  return row?.querySelector<HTMLElement>('[data-poll-voters]') ?? container;
}

/** Keep the exiting panel mounted only while its original session and membership still own it. */
export function useConversationInformation(options: {
  scope: InformationScope;
  fallbackFocus: RefObject<HTMLElement | null>;
  canDisplay: (target: InformationTarget) => boolean;
}) {
  const { scope, canDisplay, fallbackFocus } = options;
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  function isSelectionOwned(candidate: InformationSelection) {
    return (
      candidate.owner === scope.owner &&
      candidate.destination === scope.destination &&
      candidate.generation === scope.generation &&
      canDisplay(candidate.target)
    );
  }

  const layer = useHandheldPanel<InformationSelection>({
    kind: 'information',
    isValid: isSelectionOwned,
  });
  const selection = layer.selection;
  const retained = useExitingSidebarPage(selection, isSelectionOwned);
  const target = retained?.target;
  const isOpen = Boolean(selection && target);

  // prettier-ignore
  useLayoutEffect(() => {
    const didClose = wasOpen.current && !isOpen;
    wasOpen.current = isOpen;
    if (!didClose) {
      return;
    }
    const button = trigger.current;
    if (!target) {
      return;
    }
    // A virtualized poll can lose its original button while the sidebar is open.
    const canFocusButton = button?.isConnected && !button.closest('[inert], [hidden]');
    const destination = canFocusButton ? button : restoredTrigger(fallbackFocus.current, target);
    destination?.focus({ preventScroll: true });
  }, [
    selection,
    target,
    isOpen,
    fallbackFocus,
  ]);

  function open(nextTarget: InformationTarget, opener: HTMLElement | null) {
    trigger.current = opener;
    layer.open({
      ...scope,
      target: nextTarget,
      voterEntry: { current: undefined },
    });
  }

  // prettier-ignore
  return {
    target,
    voterEntry: retained?.voterEntry,
    isOpen,
    open,
    close: layer.close,
  };
}
