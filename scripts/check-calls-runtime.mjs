import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeEnvironment } from './runtime-environment.mjs';

const BROWSER_IMAGE = 'mcr.microsoft.com/playwright:v1.65.0-noble';
const BROWSER_ORIGIN = 'http://127.0.0.1';
const GATEWAY_PORT = 80;
const SECRET_BYTES = 32;
const PROVIDER_READINESS_RETRIES = 20;
const PROVIDER_RETRY_DELAY_SECONDS = 1;
const PROVIDER_REQUEST_TIMEOUT_SECONDS = 2;

export const callsEnvironment = {
  TG_CHAT_CALLS_ENABLED: 'true',
  TG_CHAT_PUBLIC_ORIGIN: BROWSER_ORIGIN,
  TG_CHAT_LIVEKIT_PUBLIC_URL: '',
  TG_CHAT_LIVEKIT_INTERNAL_URL: 'http://livekit:7880',
  TG_CHAT_LIVEKIT_API_KEY: randomBytes(SECRET_BYTES).toString('hex'),
  TG_CHAT_LIVEKIT_API_SECRET: randomBytes(SECRET_BYTES).toString('hex'),
};

// Keep all media sockets private to the randomly named Compose project.
export const callsOverride = `
services:
  livekit:
    ports: !reset []
`;

/** Run genuine Chromium media in the provider's loopback network namespace. */
export function verifyCallBrowsers({ compose, execute, root }) {
  // LiveKit has no container healthcheck, so admission must wait for its HTTP listener.
  // prettier-ignore
  const readinessArguments = [
    'exec',
    '-T',
    'api',
    'curl',
    '--fail',
    '--silent',
    '--show-error',
    '--retry',
    String(PROVIDER_READINESS_RETRIES),
    '--retry-all-errors',
    '--retry-delay',
    String(PROVIDER_RETRY_DELAY_SECONDS),
    '--max-time',
    String(PROVIDER_REQUEST_TIMEOUT_SECONDS),
    'http://livekit:7880',
  ];
  compose(readinessArguments);
  console.log('Checking the Rust LiveKit room lifecycle contract.');
  // prettier-ignore
  const contractArguments = [
    'run',
    '--rm',
    '--no-deps',
    '--build',
    'livekit-contract',
  ];
  console.log(compose(contractArguments));
  // prettier-ignore
  const containerArguments = [
    'ps',
    '-q',
    'livekit',
  ];
  const container = compose(containerArguments).trim();
  // Playwright removes its output directory before a run, so mount the writable parent.
  const results = join(root, 'web', 'test-results');
  mkdirSync(results, { recursive: true });
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'tg-chat-calls-'));
  const providerSettings = join(temporaryDirectory, 'provider.env');
  writeFileSync(
    providerSettings,
    serializeEnvironment({
      TG_CHAT_LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:7880',
      TG_CHAT_LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:7880',
      TG_CHAT_LIVEKIT_API_KEY: callsEnvironment.TG_CHAT_LIVEKIT_API_KEY,
      TG_CHAT_LIVEKIT_API_SECRET: callsEnvironment.TG_CHAT_LIVEKIT_API_SECRET,
    }),
    { mode: 0o600 },
  );

  try {
    const output = execute('docker', [
      'run',
      '--rm',
      '--network',
      `container:${container}`,
      '--shm-size=1g',
      '--mount',
      `type=bind,source=${root},target=/workspace,readonly`,
      '--mount',
      `type=bind,source=${results},target=/workspace/web/test-results`,
      '--env-file',
      providerSettings,
      '--workdir',
      '/workspace/web',
      BROWSER_IMAGE,
      'node',
      '/workspace/scripts/check-calls-runtime.mjs',
      '--browser',
    ]);
    console.log(output);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runBrowser() {
  // Present an HTTP secure-context loopback origin while forwarding every request to Caddy.
  // The provider's ICE candidates independently use loopback inside this namespace.
  const forwarder = createServer((browserSocket) => {
    const gatewaySocket = createConnection({
      host: 'gateway',
      port: GATEWAY_PORT,
    });
    browserSocket.on('error', () => gatewaySocket.destroy());
    gatewaySocket.on('error', () => browserSocket.destroy());
    browserSocket.on('close', () => gatewaySocket.destroy());
    gatewaySocket.on('close', () => browserSocket.destroy());
    browserSocket.pipe(gatewaySocket);
    gatewaySocket.pipe(browserSocket);
  });
  forwarder.listen(GATEWAY_PORT, '127.0.0.1');
  await once(forwarder, 'listening');

  try {
    const runner = spawn(
      process.execPath,
      [
        './node_modules/@playwright/test/cli.js',
        'test',
        '--config',
        'playwright.calls.config.ts',
        '--forbid-only',
      ],
      {
        env: { ...process.env, TG_CHAT_ACCOUNT_TEST_URL: BROWSER_ORIGIN },
        stdio: 'inherit',
      },
    );
    const [exitCode] = await once(runner, 'exit');
    process.exitCode = exitCode ?? 1;
  } finally {
    forwarder.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--browser')) {
  await runBrowser();
}
