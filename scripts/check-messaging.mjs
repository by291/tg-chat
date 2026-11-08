import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const REQUEST_TIMEOUT_MS = 10_000;

async function register(origin) {
  const response = await fetch(`${origin}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-tg-chat-request': '1',
    },
    body: JSON.stringify({
      username: `fault_${randomUUID().slice(0, 8)}`,
      display_name: 'Message recovery account',
      password: `acceptance-${randomUUID()}`,
      device_name: 'Fault acceptance',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const grant = await response.json();

  return { cookie, grant };
}

async function read({ origin, account, path }) {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    headers: { cookie: account.cookie },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(response.status, 200);

  return response.json();
}

function sendOptions({ origin, account, message }) {
  return {
    method: 'POST',
    headers: {
      origin,
      cookie: account.cookie,
      'content-type': 'application/json',
      'x-tg-chat-request': '1',
      'x-csrf-token': account.grant.csrf_token,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

async function loseCommittedResponse(options) {
  let accepted;
  let proxyFailure;
  const proxy = createServer(async (request, response) => {
    try {
      // Drain the browser-side request, then forward the actual operation to the real API.
      for await (const chunk of request) {
        assert.ok(chunk.byteLength > 0);
      }
      const upstream = await fetch(`${options.origin}/api/v1/messages`, sendOptions(options));
      assert.equal(upstream.status, 200);
      accepted = await upstream.json();
      // A complete successful API response proves its transaction committed before this socket drops.
      response.destroy();
    } catch (error) {
      proxyFailure = error;
      response.destroy();
    }
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const address = proxy.address();
  assert.ok(address && typeof address !== 'string');

  try {
    await assert.rejects(fetch(`http://127.0.0.1:${address.port}/messages`, sendOptions(options)));
    if (proxyFailure) {
      throw proxyFailure;
    }
    assert.ok(accepted, 'The real API must commit before the response is discarded');
    return accepted;
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve, reject) => {
      proxy.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/** Drop a real committed HTTP response, restart API, and prove one durable message reaches both users. */
export async function verifyMessageRecovery({ origin, restartApi }) {
  const sender = await register(origin);
  const recipient = await register(origin);
  const initial = await read({
    origin,
    account: recipient,
    path: 'chat/bootstrap',
  });
  const message = {
    operation_id: randomUUID(),
    message_id: randomUUID(),
    destination: { kind: 'recipient', user_id: recipient.grant.user.id },
    content: {
      schema_version: 1,
      text: 'Committed before the HTTP response disappeared.',
      rich_text: null,
      custom_emoji: [],
    },
  };
  const options = {
    origin,
    account: sender,
    message,
  };
  const accepted = await loseCommittedResponse(options);
  await restartApi();
  const replay = await fetch(`${origin}/api/v1/messages`, sendOptions(options));
  assert.equal(replay.status, 200);
  const receipt = await replay.json();
  assert.deepEqual(receipt.message, accepted.message);

  const history = await read({
    origin,
    account: sender,
    path: `conversations/${receipt.conversation.id}/history`,
  });
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].id, message.message_id);
  const changes = await read({
    origin,
    account: recipient,
    path: `chat/sync?cursor=${encodeURIComponent(initial.cursor)}`,
  });
  assert.equal(changes.groups.length, 1);
  assert.equal(changes.groups[0].message.id, message.message_id);
  assert.equal(changes.groups[0].conversation.unread_count, '1');
  assert.equal(changes.cursor, changes.observation_cursor);
  assert.equal(changes.has_more, false);
}
