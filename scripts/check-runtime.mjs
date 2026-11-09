import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { createRuntimeEnvironment, serializeEnvironment } from './runtime-environment.mjs';
import { verifyMessageRecovery } from './check-messaging.mjs';
import { verifySynchronization } from './check-synchronization.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUEST_TIMEOUT_MS = 10_000;
const STARTUP_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 1_000;
const COMMAND_TIMEOUT_MS = 1_200_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SECRET_MARKER = `private-request-${randomUUID()}`;
const OBJECT_CONTENT = 'Object storage survives service restarts.\n';
const environment = createRuntimeEnvironment({ httpPort: '0', s3Port: '0' });
environment.TG_CHAT_MAILPIT_PORT = '0';
environment.TG_CHAT_SMTP_HOST = 'mailpit';
environment.TG_CHAT_SMTP_PORT = '1025';
environment.TG_CHAT_SMTP_MODE = 'plain';
environment.TG_CHAT_MAIL_FROM = 'accounts@example.test';
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'tg-chat-runtime-'));
const environmentPath = join(temporaryDirectory, '.env');
const project = `tg-chat-check-${randomUUID()}`;
const composeArguments = [
  'compose',
  '--profile',
  'mail',
  '--project-name',
  project,
  '--env-file',
  environmentPath,
  '--file',
  join(ROOT, 'compose.yaml'),
];

function redact(message) {
  let sanitized = String(message);

  for (const [name, value] of Object.entries(environment)) {
    if (name.includes('PASSWORD') || name.includes('KEY')) {
      sanitized = sanitized.replaceAll(value, '[redacted]');
    }
  }

  return sanitized;
}

function execute(command, argumentsList, options = {}) {
  try {
    return execFileSync(command, argumentsList, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: 'pipe',
      ...options,
    });
  } catch (error) {
    // Child-process errors include argv and output, which may contain runtime credentials.
    throw new Error(redact(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`));
  }
}

function compose(argumentsList) {
  // Shell overrides must not redirect an isolated test toward another environment.
  return execute('docker', [...composeArguments, ...argumentsList], {
    env: { ...process.env, ...environment },
  });
}

function endpoint(service, port) {
  // prettier-ignore
  const binding = compose([
    'port',
    service,
    port,
  ]).trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/);

  return `http://${binding}`;
}

async function expectStatus(url, status) {
  let response;

  try {
    response = await fetch(url, {
      // Probes must not reuse sockets across deliberate process restarts.
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`HTTP probe failed for ${new URL(url).pathname}`, {
      cause: error,
    });
  }
  const expectedStatuses = Array.isArray(status) ? status : [status];
  assert.ok(
    expectedStatuses.includes(response.status),
    `${new URL(url).pathname} returned ${response.status}; expected ${expectedStatuses.join(' or ')}`,
  );

  return response.text();
}

async function waitUntilReady(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await expectStatus(url, 200);
      return;
    } catch {
      await delay(RETRY_DELAY_MS);
    }
  }

  throw new Error(`Service did not become ready: ${url}`);
}

function queryDatabase(statement) {
  return compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'tg_chat',
    '-d',
    'tg_chat',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atc',
    statement,
  ]).trim();
}

function signedStorageRequest({ origin, path, method, body }) {
  // Curl reads credentials from stdin so they never appear in process arguments.
  const configuration = [
    'silent',
    'show-error',
    'fail-with-body',
    'max-time = 15',
    'aws-sigv4 = "aws:amz:us-east-1:s3"',
    `user = "${environment.TG_CHAT_S3_ACCESS_KEY}:${environment.TG_CHAT_S3_SECRET_KEY}"`,
    `url = "${origin}${path}"`,
    `request = "${method}"`,
  ];

  if (body !== undefined) {
    const bodyPath = join(temporaryDirectory, 'object.txt');
    writeFileSync(bodyPath, body);
    configuration.push(`data-binary = "@${bodyPath}"`);
  }

  return execute('curl', ['--config', '-'], {
    input: `${configuration.join('\n')}\n`,
  });
}

async function waitForStoredObject(origin) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;

  // S3 can accept HTTP before the master has rebuilt its volume-location map.
  while (Date.now() < deadline) {
    try {
      const storedObject = signedStorageRequest({
        origin,
        path: '/runtime-check/probe.txt',
        method: 'GET',
      });
      assert.equal(storedObject, OBJECT_CONTENT);
      return;
    } catch (error) {
      lastError = error;
      await delay(RETRY_DELAY_MS);
    }
  }

  throw new Error('Stored object did not become readable after restart', {
    cause: lastError,
  });
}

async function verifyRoutes(origin) {
  await expectStatus(`${origin}/health/live`, 200);
  await expectStatus(`${origin}/health/ready`, 200);
  const page = await expectStatus(`${origin}/`, 200);
  assert.match(page, /<html/);

  const response = await fetch(`${origin}/api/unknown?password=${SECRET_MARKER}`, {
    headers: {
      authorization: `Bearer ${SECRET_MARKER}`,
      cookie: `session=${SECRET_MARKER}`,
      'x-request-id': SECRET_MARKER,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(response.status, 404);
  const error = await response.json();
  assert.equal(error.error.code, 'not_found');
  assert.equal(error.error.request_id, response.headers.get('x-request-id'));
  assert.notEqual(error.error.request_id, SECRET_MARKER);

  const unsupported = await fetch(`${origin}/health/live`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(unsupported.status, 405);
  assert.equal((await unsupported.json()).error.code, 'method_not_allowed');
}

function configurePublicOrigin(origin) {
  // Docker chooses the host port; cookie admission and email links must use that exact origin.
  environment.TG_CHAT_PUBLIC_ORIGIN = origin;
  writeFileSync(environmentPath, serializeEnvironment(environment), {
    mode: 0o600,
  });
  // prettier-ignore
  compose([
    'up',
    '-d',
    '--no-deps',
    '--wait',
    'api',
    'worker',
    'centrifugo',
  ]);
}

function resetAdmissionFixtures() {
  // The randomly named acceptance project owns this cache; never target a shared deployment.
  // prettier-ignore
  compose([
    'exec',
    '-T',
    'valkey',
    'valkey-cli',
    'FLUSHDB',
  ]);
}

function verifyAccountBrowsers(origin, suite = 'test:accounts') {
  const mailpitOrigin = endpoint('mailpit', '8025');
  // prettier-ignore
  const browserArguments = [
    '--dir',
    'web',
    suite,
  ];
  const output = execute('pnpm', browserArguments, {
    env: {
      ...process.env,
      TG_CHAT_ACCOUNT_TEST_URL: origin,
      TG_CHAT_MAILPIT_TEST_URL: mailpitOrigin,
    },
  });
  console.log(output);
}

async function submitAccountRequest({ origin, path, body }) {
  return fetch(`${origin}/api/v1/${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-tg-chat-request': '1',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function verifyValkeyOutage(origin) {
  const credentials = {
    username: `outage_${randomUUID().slice(0, 8)}`,
    password: SECRET_MARKER,
    device_name: 'Runtime acceptance',
  };
  const registration = await submitAccountRequest({
    origin,
    path: 'auth/register',
    body: { ...credentials, display_name: 'Outage account' },
  });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Registration must issue a session cookie');
  await registration.arrayBuffer();

  compose(['stop', 'valkey']);
  try {
    const login = await submitAccountRequest({
      origin,
      path: 'auth/login',
      body: credentials,
    });
    assert.equal(login.status, 503, 'Sensitive admission must fail closed without Valkey');
    await login.arrayBuffer();
    const profile = await fetch(`${origin}/api/v1/account/profile`, {
      headers: { cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert.equal(profile.status, 200, 'Existing authenticated reads must survive Valkey outage');
    assert.equal((await profile.json()).username, credentials.username);
  } finally {
    compose(['start', 'valkey']);
  }

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const login = await submitAccountRequest({
      origin,
      path: 'auth/login',
      body: credentials,
    });
    await login.arrayBuffer();
    if (login.status === 200) {
      return;
    }
    assert.equal(login.status, 503);
    await delay(RETRY_DELAY_MS);
  }

  throw new Error('Account admission did not recover after Valkey restarted');
}

async function rejectRealtimeConnection({ page, token }) {
  const rejected = await page.evaluate(
    async (options) => {
      const endpoint = new URL('/connection/websocket', window.location.href);
      endpoint.protocol = 'ws:';
      const socket = new WebSocket(endpoint);
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Realtime rejection timed out')),
            options.timeout,
          );
          socket.onopen = () =>
            socket.send(JSON.stringify({ id: 1, connect: { token: options.token } }));
          socket.onmessage = (event) => {
            const frame = JSON.parse(event.data);
            if (frame.id === 1) {
              clearTimeout(timeout);
              resolve(Boolean(frame.error));
            }
          };
          socket.onclose = (event) => {
            clearTimeout(timeout);
            resolve(event.code >= 3500);
          };
        });
      } finally {
        socket.close();
      }
    },
    { token, timeout: REQUEST_TIMEOUT_MS },
  );
  assert.equal(rejected, true, 'Personal realtime requires the authenticated session cookie');
}

async function verifyRealtimeAuthentication(origin) {
  const requireWeb = createRequire(new URL('../web/package.json', import.meta.url));
  const { chromium } = requireWeb('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    for (const token of [undefined, 'forged-client-token']) {
      await rejectRealtimeConnection({ page, token });
    }
  } finally {
    await browser.close();
  }
}

function verifyPrivateServices() {
  // prettier-ignore
  const services = [
    'postgres',
    'valkey',
    'centrifugo',
    'api',
    'worker',
  ];

  for (const service of services) {
    // prettier-ignore
    const container = compose([
      'ps',
      '-q',
      service,
    ]).trim();
    const published = execute('docker', [
      'inspect',
      '--format',
      '{{json .HostConfig.PortBindings}}',
      container,
    ]).trim();
    assert.ok(published === '{}' || published === 'null', `${service} must remain private`);
  }

  // prettier-ignore
  assert.equal(compose([
    'exec',
    '-T',
    'valkey',
    'valkey-cli',
    'ping',
  ]).trim(), 'PONG');
  compose([
    'exec',
    '-T',
    'centrifugo',
    'wget',
    '-q',
    '-O',
    '/dev/null',
    'http://localhost:8000/health',
  ]);
  const workerHealth = compose([
    'exec',
    '-T',
    'worker',
    'curl',
    '--fail',
    '--silent',
    'http://localhost:8081/health/ready',
  ]);
  assert.equal(JSON.parse(workerHealth).service, 'worker');
}

function verifyProcessExit(service) {
  // prettier-ignore
  const container = compose([
    'ps',
    '-aq',
    service,
  ]).trim();
  // prettier-ignore
  const exitCode = execute('docker', [
    'inspect',
    '--format',
    '{{.State.ExitCode}}',
    container,
  ]);
  assert.equal(exitCode.trim(), '0', `${service} must exit gracefully`);
  // prettier-ignore
  const logs = compose([
    'logs',
    '--no-color',
    service,
  ]);
  assert.match(logs, /service_draining/);
  assert.match(logs, /service_stopped/);
}

async function verifyGracefulShutdown(origin) {
  for (const service of ['worker', 'api']) {
    console.log(`Stopping ${service} while its peer remains running.`);
    compose(['stop', service]);
    verifyProcessExit(service);

    if (service === 'worker') {
      await expectStatus(`${origin}/health/ready`, 200);
    } else {
      // A stopped upstream can refuse a fresh connection or time out an existing one.
      await expectStatus(`${origin}/api/unavailable?password=${SECRET_MARKER}`, [502, 504]);
    }

    compose(['start', service]);
    await waitUntilReady(`${origin}/health/ready`);
  }
}

async function verifyPersistence({ origin, storageOrigin }) {
  queryDatabase('CREATE TABLE acceptance_probe (value text NOT NULL)');
  queryDatabase("INSERT INTO acceptance_probe VALUES ('preserved')");
  signedStorageRequest({
    origin: storageOrigin,
    path: '/runtime-check',
    method: 'PUT',
  });
  signedStorageRequest({
    origin: storageOrigin,
    path: '/runtime-check/probe.txt',
    method: 'PUT',
    body: OBJECT_CONTENT,
  });
  await expectStatus(`${storageOrigin}/runtime-check/probe.txt`, 403);

  console.log('Checking PostgreSQL outage and recovery.');
  compose(['stop', 'postgres']);
  await expectStatus(`${origin}/health/ready`, 503);
  await expectStatus(`${origin}/health/live`, 200);
  compose(['start', 'postgres']);
  await waitUntilReady(`${origin}/health/ready`);

  console.log('Checking independent process shutdown and gateway failures.');
  await verifyGracefulShutdown(origin);
  // prettier-ignore
  compose([
    'restart',
    'gateway',
    'seaweedfs',
  ]);
  console.log('Checking storage after gateway and SeaweedFS restarts.');
  // Docker can allocate new ephemeral host ports when containers restart.
  const restartedOrigin = endpoint('gateway', '80');
  const restartedStorageOrigin = endpoint('seaweedfs', '8333');
  await waitUntilReady(`${restartedOrigin}/health/ready`);
  await waitUntilReady(`${restartedStorageOrigin}/healthz`);
  assert.equal(queryDatabase('SELECT value FROM acceptance_probe'), 'preserved');
  await waitForStoredObject(restartedStorageOrigin);
}

async function main() {
  writeFileSync(environmentPath, serializeEnvironment(environment), {
    mode: 0o600,
  });

  try {
    console.log('Building isolated runtime images.');
    // prettier-ignore
    compose([
      'build',
      'api',
      'worker',
      'gateway',
      'verification',
    ]);
    console.log('Starting real dependencies and application processes.');
    // prettier-ignore
    compose([
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
    ]);
    const origin = endpoint('gateway', '80');
    const storageOrigin = endpoint('seaweedfs', '8333');

    configurePublicOrigin(origin);
    await waitUntilReady(`${origin}/health/ready`);

    await verifyRoutes(origin);
    await verifyRealtimeAuthentication(origin);
    verifyPrivateServices();
    console.log('Checking migrations against real PostgreSQL.');
    // prettier-ignore
    compose([
      '--profile',
      'verification',
      'run',
      '--rm',
      'verification',
    ]);
    console.log('Checking committed-response loss and message replay across API restart.');
    await verifyMessageRecovery({
      origin,
      restartApi: async () => {
        compose(['restart', 'api']);
        await waitUntilReady(`${origin}/health/ready`);
      },
    });
    resetAdmissionFixtures();
    console.log('Checking durable synchronization during Worker and realtime outages.');
    await verifySynchronization({
      origin,
      compose,
      queryDatabase,
    });
    // Independent fixtures share one loopback IP. Clear only this random project's test cache.
    resetAdmissionFixtures();
    console.log('Checking real account and messaging browsers and SMTP links.');
    verifyAccountBrowsers(origin);
    resetAdmissionFixtures();
    console.log('Checking four-session browser convergence and full reset.');
    verifyAccountBrowsers(origin, 'test:sync');
    resetAdmissionFixtures();
    console.log('Checking real community admission, moderation, and subscriber privacy.');
    verifyAccountBrowsers(origin, 'test:communities');
    resetAdmissionFixtures();
    console.log('Checking fail-closed admission and surviving reads during Valkey outage.');
    await verifyValkeyOutage(origin);
    console.log('Checking outages, graceful shutdown, and persistent private storage.');
    await verifyPersistence({ origin, storageOrigin });

    const logs = compose(['logs', '--no-color']);
    assert.ok(!logs.includes(SECRET_MARKER), 'Request secrets must not appear in logs');

    for (const [name, value] of Object.entries(environment)) {
      if (name.includes('PASSWORD') || name.includes('KEY')) {
        assert.ok(!logs.includes(value), `${name} must not appear in logs`);
      }
    }

    console.log('Runtime acceptance passed.');
  } catch (error) {
    // prettier-ignore
    console.error(redact(compose([
      'logs',
      '--no-color',
      '--tail',
      '30',
    ])));
    throw error;
  } finally {
    // Only this randomly named acceptance project owns the volumes removed here.
    // prettier-ignore
    compose([
      'down',
      '--volumes',
      '--remove-orphans',
    ]);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
