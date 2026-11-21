// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChatLayout } from './ChatLayout';

it('remembers independent sidebar widths and keeps keyboard resizing within bounds', () => {
  const layout = (
    <ChatLayout
      messageTextSize={16}
      isDetailsOpen
      isMobileChatOpen
      background={null}
      sidebar={null}
      conversation={<main />}
      details={null}
    />
  );
  const first = render(layout);
  const left = screen.getByRole('separator', { name: 'Resize conversation directory' });
  const right = screen.getByRole('separator', { name: 'Resize information panel' });
  fireEvent.keyDown(left, { key: 'End' });
  fireEvent.keyDown(left, { key: 'ArrowRight' });
  fireEvent.keyDown(right, { key: 'Home' });
  fireEvent.keyDown(right, { key: 'ArrowRight' });
  first.unmount();

  const second = render(layout);
  expect(screen.getByLabelText('Resize conversation directory').getAttribute('aria-valuenow')).toBe(
    '480',
  );
  expect(screen.getByLabelText('Resize information panel').getAttribute('aria-valuenow')).toBe(
    '320',
  );
  second.unmount();
});
