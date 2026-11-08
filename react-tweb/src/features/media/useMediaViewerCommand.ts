import { useEffect, useRef } from 'react';
import type { MessageCommand } from '@/features/chat/messages/commands';
import type { MediaViewerCommand } from './mediaViewerCommands';

interface UseMediaViewerCommandOptions {
  chatId: string;
  command?: MediaViewerCommand;
  onMessageCommand: (command: MessageCommand) => void;
  onJumpToMessage: (messageId: string) => void;
}

/** Route each viewer request once through the conversation's existing commands. */
export function useMediaViewerCommand({
  chatId,
  command,
  onMessageCommand,
  onJumpToMessage,
}: UseMediaViewerCommandOptions) {
  const appliedCommand = useRef<MediaViewerCommand | undefined>(undefined);

  useEffect(
    () => {
      const isTargetConversation = command?.message.chatId === chatId;
      if (!command || !isTargetConversation || appliedCommand.current === command) {
        return;
      }
      // Callback identities change with conversation state; they must not replay a user request.
      appliedCommand.current = command;
      if (command.action === 'go-to-message') {
        onJumpToMessage(command.message.id);
        return;
      }

      const action = command.action === 'edit-caption' ? 'edit' : command.action;
      onMessageCommand({ action, message: command.message });
    },
    // prettier-ignore
    [
      chatId,
      command,
      onMessageCommand,
      onJumpToMessage,
    ],
  );
}
