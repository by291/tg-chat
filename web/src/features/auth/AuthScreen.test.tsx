// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { AuthScreen } from './AuthScreen';
import { SessionOwner } from './SessionOwner';

const CAPABILITIES = {
  registration_open: true,
  email_recovery_available: false,
  avatars_available: false,
  messaging_available: false,
  calls_available: false,
};

afterEach(cleanup);

it('explains unavailable recovery without presenting a working email action', () => {
  const owner = new SessionOwner({ baseUrl: 'http://localhost:8080' });
  render(<AuthScreen owner={owner} capabilities={CAPABILITIES} />);

  const recovery = screen.getByRole('button', { name: 'Forgot password' });
  expect(recovery.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Email recovery is not enabled on this server.')).toBeTruthy();
});

it('shows a safe credential error and leaves the submitted account unauthenticated', async () => {
  const owner = new SessionOwner({
    baseUrl: 'http://localhost:8080',
    fetch: async () =>
      Response.json(
        {
          error: {
            code: 'invalid_credentials',
            message: 'The username or password is incorrect.',
            request_id: 'request-id',
          },
        },
        { status: 401 },
      ),
  });
  render(<AuthScreen owner={owner} capabilities={CAPABILITIES} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Username'), 'alice');
  await user.type(screen.getByLabelText('Password'), 'a complete password phrase');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'The username or password is incorrect.',
  );
  expect(owner.getSnapshot().auth).toBeNull();
});
