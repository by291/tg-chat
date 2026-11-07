// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../demo/fixtures';
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
