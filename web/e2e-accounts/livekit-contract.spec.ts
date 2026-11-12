import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { SignJWT } from 'jose';
import type { Room as LiveKitRoom } from 'livekit-client';

const TOKEN_LIFETIME_SECONDS = 60;
const MAX_PARTICIPANTS = 2;
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

const browserBundle = fileURLToPath(
  new URL('../node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url),
);

type Provider = {
  key: string;
  secret: string;
  adminUrl: URL;
  signalingUrl: URL;
};

type RoomGrants = {
  room: string;
  roomCreate?: true;
  roomJoin?: true;
};

type FixtureWindow = Window & {
  LivekitClient: { Room: typeof LiveKitRoom };
};

function requiredSetting(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Set ${name} for the disposable LiveKit integration runtime`);
  }

  return value;
}

function loopbackUrl(name: string, protocol: string): URL {
  const url = new URL(requiredSetting(name));
  if (url.protocol !== protocol || !LOOPBACK_HOSTNAMES.includes(url.hostname)) {
    throw new Error(`${name} must point to the disposable loopback LiveKit runtime`);
  }

  return url;
}

async function roomToken(
  provider: Provider,
  identity: string,
  grants: RoomGrants,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = new SignJWT({ video: grants }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' });
  token.setIssuer(provider.key).setSubject(identity).setIssuedAt(issuedAt);
  token.setNotBefore(issuedAt).setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS);

  return token.sign(new TextEncoder().encode(provider.secret));
}

async function administerRoom(
  provider: Provider,
  operation: 'CreateRoom' | 'DeleteRoom',
  roomName: string,
): Promise<void> {
  const url = new URL(`/twirp/livekit.RoomService/${operation}`, provider.adminUrl);
  const token = await roomToken(provider, 'fixture-admin', { room: roomName, roomCreate: true });
  const body =
    operation === 'CreateRoom'
      ? { name: roomName, max_participants: MAX_PARTICIPANTS }
      : { room: roomName };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  expect(response.status, operation).toBe(200);
}

test('an explicitly created room admits two browser participants', async ({ page }) => {
  const provider = {
    key: requiredSetting('TG_CHAT_LIVEKIT_API_KEY'),
    secret: requiredSetting('TG_CHAT_LIVEKIT_API_SECRET'),
    adminUrl: loopbackUrl('TG_CHAT_LIVEKIT_INTERNAL_URL', 'http:'),
    signalingUrl: loopbackUrl('TG_CHAT_LIVEKIT_PUBLIC_URL', 'ws:'),
  };
  const roomName = `contract-${randomUUID()}`;
  await page.goto(provider.adminUrl.href);
  await page.addScriptTag({ path: browserBundle });

  await administerRoom(provider, 'CreateRoom', roomName);
  try {
    const grants = { room: roomName, roomJoin: true } satisfies RoomGrants;
    const [callerToken, calleeToken, overflowToken] = await Promise.all([
      roomToken(provider, 'fixture-caller', grants),
      roomToken(provider, 'fixture-callee', grants),
      roomToken(provider, 'fixture-overflow', grants),
    ]);
    const connected = await page.evaluate(
      async ({ signalingUrl, callerToken, calleeToken, overflowToken }) => {
        const { Room } = (window as unknown as FixtureWindow).LivekitClient;
        const caller = new Room();
        const callee = new Room();
        const overflow = new Room();

        try {
          await caller.connect(signalingUrl, callerToken);
          await callee.connect(signalingUrl, calleeToken);

          const overflowJoinedWhileFull = await overflow.connect(signalingUrl, overflowToken).then(
            () => true,
            () => false,
          );
          return {
            caller: caller.localParticipant.identity,
            callee: callee.localParticipant.identity,
            callerState: caller.state,
            calleeState: callee.state,
            overflowJoinedWhileFull,
          };
        } finally {
          await Promise.all([caller.disconnect(), callee.disconnect(), overflow.disconnect()]);
        }
      },
      {
        signalingUrl: provider.signalingUrl.href,
        callerToken,
        calleeToken,
        overflowToken,
      },
    );

    expect(connected.caller).toBe('fixture-caller');
    expect(connected.callee).toBe('fixture-callee');
    expect(connected.callerState).toBe('connected');
    expect(connected.calleeState).toBe('connected');
    expect(connected.overflowJoinedWhileFull).toBe(false);
  } finally {
    await administerRoom(provider, 'DeleteRoom', roomName);
  }
});
