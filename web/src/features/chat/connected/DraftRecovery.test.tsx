// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DraftRecovery } from './DraftRecovery';

it('keeps the draft alternatives behind a compact disclosure until the user reviews them', () => {
  const restore = vi.fn();
  const keep = vi.fn();
  const remote = { id: 'remote', value: { text: 'Another device draft' } };
  render(
    <DraftRecovery
      local={{ id: 'local', value: { text: 'Keep typing here' } }}
      conflict={remote}
      alternatives={[{ id: 'older', value: { text: 'Earlier text' } }]}
      onKeep={keep}
      onRestore={restore}
    />,
  );

  expect(screen.queryByText('Another device draft')).toBeNull();
  expect(screen.queryByText('Earlier text')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review drafts' }));
  expect(screen.getByText('Keep typing here')).toBeTruthy();
  expect(screen.getByText('Earlier text')).toBeTruthy();
  expect(restore).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Use other draft' }));
  expect(restore).toHaveBeenCalledWith(remote);
});
