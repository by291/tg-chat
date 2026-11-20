import { expect, type BrowserContext } from '@playwright/test';
import type { components } from '../src/api/schema';

interface AccountRegistration {
  context: BrowserContext;
  origin: string;
  username: string;
  displayName: string;
  password: string;
  deviceName: string;
}

interface MutationIdentity {
  origin: string;
  grant: components['schemas']['AuthResponse'];
}

/** Register an isolated browser identity through the public account boundary. */
export async function registerAccount(options: AccountRegistration) {
  const response = await options.context.request.post('/api/v1/auth/register', {
    headers: { origin: options.origin, 'x-tg-chat-request': '1' },
    data: {
      username: options.username,
      display_name: options.displayName,
      password: options.password,
      device_name: options.deviceName,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as components['schemas']['AuthResponse'];
}

/** Supply the origin and session proof required by connected mutations. */
export function mutationHeaders({ origin, grant }: MutationIdentity) {
  return {
    origin,
    'x-tg-chat-request': '1',
    'x-csrf-token': grant.csrf_token,
  };
}

/** Close every owned context even when another context fails during teardown. */
export async function closeContexts(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}
