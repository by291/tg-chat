import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { readSidebarWidth, SidebarResizer } from './SidebarResizer';
import styles from './ChatLayout.module.css';

interface ChatLayoutProps {
  messageTextSize: number;
  isDetailsOpen: boolean;
  isMobileChatOpen: boolean;
  background: ReactNode;
  sidebar: ReactNode;
  conversation: ReactNode;
  details: ReactNode;
  children?: ReactNode;
}

/** Arrange chat surfaces while preserving panel mounting, responsive geometry, and transitions. */
export function ChatLayout({
  messageTextSize,
  isDetailsOpen,
  isMobileChatOpen,
  background,
  sidebar,
  conversation,
  details,
  children,
}: ChatLayoutProps) {
  const [leftWidth, setLeftWidth] = useState(() => readSidebarWidth('left'));
  const [rightWidth, setRightWidth] = useState(() => readSidebarWidth('right'));
  const sidebarRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const previousMobileOpen = useRef(isMobileChatOpen);
  const directoryTrigger = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const didSwitch = previousMobileOpen.current !== isMobileChatOpen;
    previousMobileOpen.current = isMobileChatOpen;
    if (!didSwitch || !window.matchMedia?.('(max-width: 760px)').matches) {
      return;
    }

    // A handheld column disappears from the focus order while its editor stays mounted.
    const visible = isMobileChatOpen ? conversationRef.current : sidebarRef.current;
    const trigger = directoryTrigger.current;
    const canRestore = !isMobileChatOpen && trigger?.isConnected && !trigger.closest('[inert]');
    const buttons = visible?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [];
    const first = Array.from(buttons).find((button) => button.getClientRects().length > 0);
    const target = canRestore ? trigger : first;
    target?.focus({ preventScroll: true });
  }, [isMobileChatOpen]);

  const geometry = {
    '--message-text-size': `${messageTextSize}px`,
    '--left-width': `${leftWidth}px`,
    '--right-width': `${rightWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={styles.layout}
      style={geometry}
      data-details-open={isDetailsOpen}
      data-mobile-chat-open={isMobileChatOpen}
    >
      {background}
      <div
        className={styles.sidebarSlot}
        ref={sidebarRef}
        onClickCapture={(event) => {
          if (event.target instanceof Element) {
            directoryTrigger.current = event.target.closest('button');
          }
        }}
      >
        {sidebar}
        <SidebarResizer side="left" width={leftWidth} onResize={setLeftWidth} />
      </div>
      <div className={styles.conversationSlot} ref={conversationRef}>
        {conversation}
      </div>
      <div className={styles.detailsSlot} inert={!isDetailsOpen} aria-hidden={!isDetailsOpen}>
        {details}
        {isDetailsOpen && (
          <SidebarResizer side="right" width={rightWidth} onResize={setRightWidth} />
        )}
      </div>
      {children}
    </div>
  );
}
