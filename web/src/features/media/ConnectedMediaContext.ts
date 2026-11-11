import { createContext } from 'react';
import type { SessionOwner } from '@/features/auth/SessionOwner';

interface ConnectedMediaActions {
  session: SessionOwner;
  retry: (messageId: string) => void;
  cancel: (messageId: string) => void;
  jump: (messageId: string) => void;
  reselect: (input: { messageId: string; occurrenceId: string; file: File }) => void;
  notify: (message: string) => void;
}

export const ConnectedMediaContext = createContext<ConnectedMediaActions | undefined>(undefined);
