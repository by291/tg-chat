import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const DATABASE = 'tg_chat_media_restore';
const FIXTURE_PASSWORD = 'a complete browser password phrase';
const EXPECTED_BYTES = 9 * 1024 * 1024;
const EXPECTED_BYTE = 31;
const TIMEOUT_MS = 20_000;
const STORAGE_IMAGE = 'caddy:2.11.7-alpine';

function restoreDatabase({ compose, queryDatabase }) {
  const dump = compose([
    'exec',
    '-T',
    'postgres',
    'pg_dump',
    '-U',
    'tg_chat',
    '--no-owner',
    '--no-privileges',
    'tg_chat',
  ]);
  queryDatabase(`CREATE DATABASE ${DATABASE}`);
  const restore = [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'tg_chat',
    '-d',
    DATABASE,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
  ];
  compose(restore, { input: dump });
}

function restoreStore({ execute, project, restoreVolume }) {
  execute('docker', [
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    '/bin/sh',
    '--volume',
    `${project}_rustfs-data:/backup:ro`,
    '--volume',
    `${restoreVolume}:/restore`,
    STORAGE_IMAGE,
    '-ec',
    'cp -a /backup/. /restore/',
  ]);
}

function writeRestoreOverride({ path, restoreVolume }) {
  const databaseUrl = 'postgres://tg_chat:${TG_CHAT_DATABASE_PASSWORD}@postgres:5432/';
  const environment = { TG_CHAT_DATABASE_URL: databaseUrl + DATABASE };
  const override = {
    services: {
      api: { environment },
      worker: { environment },
      rustfs: {
        volumes: [{ type: 'volume', source: 'restored-media', target: '/data' }],
      },
    },
    volumes: {
      'restored-media': { external: true, name: restoreVolume },
    },
  };
  writeFileSync(path, JSON.stringify(override, null, 2), { mode: 0o600 });
}

async function restoredCookie({ origin, username }) {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-tg-chat-request': '1',
    },
    body: JSON.stringify({
      username,
      password: FIXTURE_PASSWORD,
      device_name: 'Restore verification',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  assert.equal(response.status, 200, 'Restored account can authenticate');
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'Restored session includes an authentication cookie');

  return cookie.split(';', 1)[0];
}

async function checkRestoredAttachment({ origin, fixture }) {
  const cookie = await restoredCookie({ origin, username: fixture.username });
  const reference = `messages/${fixture.message_id}/attachments/${fixture.occurrence_id}/original`;
  const signed = await fetch(`${origin}/api/v1/media/${reference}`, {
    headers: { cookie, 'x-tg-chat-request': '1' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  assert.equal(signed.status, 200, 'Restored message authorizes its attachment');
  const { url } = await signed.json();
  const download = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  assert.equal(download.status, 200, 'Restored object is available through the signed URL');
  const bytes = new Uint8Array(await download.arrayBuffer());
  assert.equal(bytes.length, EXPECTED_BYTES);
  assert.ok(
    bytes.every((byte) => byte === EXPECTED_BYTE),
    'Restored bytes match the sent file',
  );
}

/** Restore a database dump and a stopped RustFS volume inside the isolated test project. */
export async function verifyMediaBackup(options) {
  const {
    compose,
    queryDatabase,
    execute,
    project,
    restoreVolume,
    path,
    endpoint,
    writePublicOrigins,
    waitUntilReady,
  } = options;
  const fixture = JSON.parse(
    queryDatabase(
      "SELECT json_build_object('username', account.username, 'message_id', message.id, " +
        "'occurrence_id', reference.occurrence_id) " +
        'FROM messages message ' +
        'JOIN media_message_references reference ON reference.message_id = message.id ' +
        'JOIN media_files file ON file.id = reference.file_id ' +
        'JOIN media_uploads upload ON upload.id = file.upload_id ' +
        'JOIN conversation_members member ON member.conversation_id = message.conversation_id ' +
        'JOIN users account ON account.id = member.user_id ' +
        "WHERE upload.file_name = 'resumable-document.bin' " +
        "AND account.display_name = 'Media Recipient'",
    ),
  );

  // Stop both control-plane mutations and outstanding signed writes before the paired backup.
  compose(['stop', 'api', 'worker', 'media-origin']);
  restoreDatabase({ compose, queryDatabase });
  compose(['stop', 'rustfs']);
  restoreStore({ execute, project, restoreVolume });
  writeRestoreOverride({ path, restoreVolume });

  compose(['--file', path, 'up', '-d', '--wait', 'rustfs', 'media-origin']);
  const origin = endpoint('gateway', '80');
  const storage = endpoint('media-origin', '8333');
  writePublicOrigins(origin, storage);
  compose(['--file', path, 'up', '-d', '--no-deps', '--wait', 'api', 'worker']);
  await waitUntilReady(`${origin}/health/ready`);
  await checkRestoredAttachment({ origin, fixture });
}
