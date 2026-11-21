import type { Message } from '@/domain/messages/message';
import { createContext } from 'react';
import type { SessionOwner } from '@/features/auth/SessionOwner';

export interface GallerySelection {
  message: Message;
  occurrenceId: string;
}

export interface ConnectedMediaActions {
  openGallery: (selection: GallerySelection) => void;
  session: SessionOwner;
  retry: (messageId: string) => void;
  cancel: (messageId: string) => void;
  jump: (messageId: string) => void;
  reselect: (input: { messageId: string; occurrenceId: string; file: File }) => void;
  notify: (message: string) => void;
}

export const ConnectedMediaContext = createContext<ConnectedMediaActions | undefined>(undefined);
