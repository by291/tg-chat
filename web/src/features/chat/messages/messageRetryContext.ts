import { createContext } from 'react';

/** Let connected bubbles retry a durable send with its original message ID. */
export const MessageRetryContext = createContext<((messageId: string) => void) | undefined>(
  undefined,
);
