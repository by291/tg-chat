import type { CSSProperties, ReactNode } from 'react';
import styles from './ChatLayout.module.css';

interface ChatLayoutProps {
  messageTextSize: number;
  isDetailsOpen: boolean;
  isMobileChatOpen: boolean;
  background: ReactNode;
  sidebar: ReactNode;
  conversation: ReactNode;
  details: ReactNode;
  children: ReactNode;
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
  return (
    <div
      className={styles.layout}
      style={{ '--message-text-size': `${messageTextSize}px` } as CSSProperties}
      data-details-open={isDetailsOpen}
      data-mobile-chat-open={isMobileChatOpen}
    >
      {background}
      <div className={styles.sidebarSlot}>{sidebar}</div>
      <div className={styles.conversationSlot}>{conversation}</div>
      <div className={styles.detailsSlot} inert={!isDetailsOpen} aria-hidden={!isDetailsOpen}>
        {details}
      </div>
      {children}
    </div>
  );
}
