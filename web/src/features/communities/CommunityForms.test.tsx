// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CommunitySettingsForm, readCommunitySettings } from './CommunityForms';

it('keeps the saved handle when a manager makes a community private after editing it', async () => {
  const onSubmit = vi.fn<(settings: ReturnType<typeof readCommunitySettings>) => Promise<void>>();
  render(
    <CommunitySettingsForm
      initial={{
        title: 'Study group',
        description: '',
        is_public: true,
        public_handle: 'study_group',
        requires_approval: false,
      }}
      onSubmit={async (fields) => onSubmit(readCommunitySettings(fields))}
    />,
  );

  fireEvent.change(screen.getByLabelText('Public handle'), { target: { value: 'unfinished @' } });
  fireEvent.click(screen.getByLabelText('Public discovery'));
  fireEvent.click(screen.getByRole('button', { name: 'Save community settings' }));

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: false, public_handle: 'study_group' }),
    );
  });
});
