import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const REQUEST_TIMEOUT_MS = 10_000;
const RECOVERY_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 250;

async function register(origin) {
  const response = await fetch(`${origin}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-tg-chat-request': '1',
    },
    body: JSON.stringify({
      username: `sync_${randomUUID().slice(0, 8)}`,
      display_name: 'Synchronization recovery',
      password: `acceptance-${randomUUID()}`,
      device_name: 'Recovery acceptance',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const grant = await response.json();
  return { cookie, grant };
}

async function request(options) {
  const response = await fetch(`${options.origin}/api/v1/${options.path}`, {
    method: options.body ? 'POST' : 'GET',
    headers: {
      origin: options.origin,
      cookie: options.account.cookie,
      'content-type': 'application/json',
      'x-tg-chat-request': '1',
      'x-csrf-token': options.account.grant.csrf_token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(response.status, options.status ?? 200);
  return response.json();
}

async function waitFor(check) {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(RETRY_DELAY_MS);
  }
  throw new Error('Synchronization recovery did not finish before its deadline.');
}

/** Exercise durable feed recovery with actual Worker, realtime, and ephemeral-cache failures. */
export async function verifySynchronization({ origin, compose, queryDatabase }) {
  const account = await register(origin);
  const bootstrap = await request({
    origin,
    account,
    path: 'chat/bootstrap',
  });
  // prettier-ignore
  compose([
    'stop',
    'worker',
    'centrifugo',
  ]);
  try {
    const sent = await request({
      origin,
      account,
      path: 'messages',
      body: {
        operation_id: randomUUID(),
        message_id: randomUUID(),
        destination: { kind: 'saved' },
        content: {
          schema_version: 1,
          text: 'Committed during realtime outage',
          custom_emoji: [],
        },
      },
    });
    const changes = await request({
      origin,
      account,
      path: `chat/sync?cursor=${bootstrap.cursor}`,
    });
    assert.ok(changes.groups.some((group) => group.message?.id === sent.message.id));
    const deletion = {
      operation_id: randomUUID(),
      conversation_id: sent.conversation.id,
      action: { kind: 'delete', message_id: sent.message.id },
    };
    await request({
      origin,
      account,
      path: 'chat/commands',
      body: deletion,
    });
    // Losing Valkey cannot erase durable changes, command receipts, or publication intent.
    // prettier-ignore
    compose([
      'exec',
      '-T',
      'valkey',
      'valkey-cli',
      'FLUSHDB',
    ]);
    const replay = await request({
      origin,
      account,
      path: 'chat/commands',
      body: deletion,
    });
    assert.equal(replay.message.is_deleted, true);
    const history = await request({
      origin,
      account,
      path: `conversations/${sent.conversation.id}/history`,
    });
    assert.deepEqual(history.messages, []);

    // Advance time for only this fixture's prefix; the real retention worker owns floor/deletion.
    const userId = account.grant.user.id;
    assert.match(userId, /^[0-9a-f-]{36}$/);
    queryDatabase(`UPDATE personal_changes SET created_at = now() - interval '31 days'
      WHERE user_id = '${userId}'`);
    // prettier-ignore
    compose([
      'start',
      'centrifugo',
      'worker',
    ]);
    await waitFor(
      () =>
        queryDatabase(`SELECT count(*) FROM sync_wakeups
      WHERE user_id = '${userId}'`) === '0',
    );
    await waitFor(
      () =>
        queryDatabase(`SELECT retained_floor > 0 FROM sync_heads
      WHERE user_id = '${userId}'`) === 't',
    );
    const reset = await request({
      origin,
      account,
      path: `chat/sync?cursor=${bootstrap.cursor}`,
      status: 409,
    });
    assert.equal(reset.error.code, 'sync_reset_required');
    const replacement = await request({
      origin,
      account,
      path: 'chat/bootstrap',
    });
    const settled = await request({
      origin,
      account,
      path: `chat/sync?cursor=${replacement.cursor}`,
    });
    assert.deepEqual(settled.groups, []);
  } finally {
    // prettier-ignore
    compose([
      'start',
      'centrifugo',
      'worker',
    ]);
  }
}
