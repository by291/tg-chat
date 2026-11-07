// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { messageSchema } from '../model';
import { MessageBubble } from './MessageBubble';

afterEach(cleanup);

const message = {
  ...createInitialState().messages[0],
  authorId: 'alex',
  authorName: 'Alex',
  text: 'A plain message',
};

function renderTextBubble({ shouldShowSender }: { shouldShowSender: boolean }) {
  return render(
    <MessageBubble
      message={message}
      shouldShowSender={shouldShowSender}
      isGroupStart
      isGroupEnd
      isHighlighted={false}
      onInteract={() => {}}
      onReact={() => {}}
      onOpenMedia={() => {}}
      onJumpToMessage={() => {}}
    />,
  );
}

function renderReplyBubble({
  replyMessage,
  replyQuote,
  onJumpToMessage,
}: {
  replyMessage?: typeof message;
  replyQuote?: { text: string };
  onJumpToMessage: (messageId: string) => void;
}) {
  const replyingMessage = messageSchema.parse({
    ...message,
    id: 'replying-message',
    replyToId: 'original-message',
    replyQuote,
  });

  return render(
    <MessageBubble
      message={replyingMessage}
      replyMessage={replyMessage}
      isGroupStart
      isGroupEnd
      isHighlighted={false}
      onInteract={() => {}}
      onReact={() => {}}
      onOpenMedia={() => {}}
      onJumpToMessage={onJumpToMessage}
    />,
  );
}

describe('text message senders', () => {
  it('shows the sender name for a group message', () => {
    renderTextBubble({ shouldShowSender: true });
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('A plain message')).toBeTruthy();
  });

  it('omits the redundant sender name in a private conversation', () => {
    renderTextBubble({ shouldShowSender: false });
    expect(screen.queryByText('Alex')).toBeNull();
    expect(screen.getByText('A plain message')).toBeTruthy();
  });
});

describe('message replies', () => {
  const originalMessage = {
    ...message,
    id: 'original-message',
    authorId: 'mia',
    authorName: 'Mia',
    text: 'The full original message has several paragraphs.',
  };

  it('jumps to the original message when its preview is activated', () => {
    const onJumpToMessage = vi.fn();
    renderReplyBubble({ replyMessage: originalMessage, onJumpToMessage });

    fireEvent.click(screen.getByRole('button', { name: /Mia/ }));

    expect(onJumpToMessage).toHaveBeenCalledWith('original-message');
  });

  it('prevents navigation when the original message is unavailable', () => {
    const onJumpToMessage = vi.fn();
    renderReplyBubble({ onJumpToMessage });

    const replyButton = screen.getByRole('button', { name: /Message unavailable/ });
    fireEvent.click(replyButton);

    expect(replyButton.hasAttribute('disabled')).toBe(true);
    expect(onJumpToMessage).not.toHaveBeenCalled();
  });

  it('shows the saved partial quote instead of the full original message', () => {
    renderReplyBubble({
      replyMessage: originalMessage,
      replyQuote: { text: 'Several selected lines\nfrom the original message.' },
      onJumpToMessage: () => {},
    });

    const replyButton = screen.getByRole('button', { name: /Mia/ });
    expect(replyButton.textContent).toContain('Several selected lines\nfrom the original message.');
    expect(replyButton.textContent).not.toContain(originalMessage.text);
  });
});
