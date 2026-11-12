// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { messageSchema, type Message } from '@/domain/messages/message';
import { DEFAULT_APP_PREFERENCES, setAppPreferences } from '@/features/settings/appPreferences';
import { MessageBubble } from './MessageBubble';
import { MessageRetryContext } from './messageRetryContext';

afterEach(() => {
  cleanup();
  setAppPreferences(DEFAULT_APP_PREFERENCES);
});

const message = {
  ...createInitialState().messages[0],
  authorId: 'alex',
  authorName: 'Alex',
  text: 'A plain message',
};

function renderTextBubble({
  shouldShowSender,
  bubbleMessage = message,
  onRetry,
}: {
  shouldShowSender: boolean;
  bubbleMessage?: Message;
  onRetry?: (messageId: string) => void;
}) {
  return render(
    <MessageRetryContext.Provider value={onRetry}>
      <MessageBubble
        message={bubbleMessage}
        shouldShowSender={shouldShowSender}
        isGroupStart
        isGroupEnd
        isHighlighted={false}
        onInteract={() => {}}
        onReact={() => {}}
        onOpenMedia={() => {}}
        onJumpToMessage={() => {}}
      />
    </MessageRetryContext.Provider>,
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
  it('restores the ordinary bubble when large emoji is turned off', () => {
    const { container } = render(
      <MessageBubble
        message={{ ...message, text: '😀😀' }}
        isGroupStart
        isGroupEnd
        isHighlighted={false}
        onInteract={() => {}}
        onReact={() => {}}
        onOpenMedia={() => {}}
        onJumpToMessage={() => {}}
      />,
    );
    expect(container.querySelector('[data-standalone="true"]')).toBeTruthy();
    act(() => setAppPreferences({ shouldUseLargeEmoji: false }));
    expect(container.querySelector('[data-standalone="true"]')).toBeNull();
    expect(screen.getByText('😀😀')).toBeTruthy();
  });

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

describe('outgoing message status', () => {
  it.each([
    { deliveryStatus: 'queued', label: 'Queued for sending' },
    { deliveryStatus: 'sending', label: 'Sending' },
  ] as const)('shows a clock while a message is $deliveryStatus', ({ deliveryStatus, label }) => {
    renderTextBubble({
      shouldShowSender: false,
      bubbleMessage: { ...message, authorId: 'you', deliveryStatus },
    });

    expect(screen.getByRole('img', { name: label }).querySelector('circle')).toBeTruthy();
  });

  const failedMessage: Message = {
    ...message,
    id: 'pending-message',
    authorId: 'you',
    deliveryStatus: 'failed',
  };

  it('retries the failed message with a single keyboard-accessible control', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = renderTextBubble({
      shouldShowSender: false,
      bubbleMessage: failedMessage,
      onRetry,
    });

    const retry = screen.getByRole('button', { name: /retry sending message/i });
    const metadata = container.querySelector('[data-message-metadata]');
    expect(metadata?.querySelectorAll('button')).toHaveLength(1);

    await user.tab();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    expect(onRetry).toHaveBeenCalledExactlyOnceWith('pending-message');
  });

  it('leaves failed attachments to the upload controls', () => {
    renderTextBubble({
      shouldShowSender: false,
      bubbleMessage: {
        ...failedMessage,
        pendingMedia: {
          status: 'Upload failed',
          items: [{ occurrenceId: 'upload', filename: 'photo.jpg', isReady: false }],
        },
      },
      onRetry: vi.fn(),
    });

    expect(screen.getByRole('img', { name: 'Send failed' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry sending message/i })).toBeNull();
  });

  it('shows the server acceptance receipt without an option to retry', () => {
    renderTextBubble({
      shouldShowSender: false,
      bubbleMessage: { ...failedMessage, deliveryStatus: 'accepted' },
      onRetry: vi.fn(),
    });

    expect(screen.getByRole('img', { name: 'Stored on server' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry sending message/i })).toBeNull();
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

it('updates visible message timestamps when the time format changes', () => {
  const { container } = renderTextBubble({ shouldShowSender: false });
  const previousTime = container.querySelector('time')!.textContent;
  expect(previousTime).toMatch(/AM|PM/);
  act(() => setAppPreferences({ timeFormat: 'h23' }));
  expect(container.querySelector('time')!.textContent).toMatch(/^\d{2}:\d{2}$/);
});
