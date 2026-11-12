import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BROWSER_IMAGE = 'mcr.microsoft.com/playwright:v1.65.0-noble';
const BROWSER_ORIGIN = 'http://127.0.0.1';
const GATEWAY_PORT = 80;
const SECRET_BYTES = 32;

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
  const container = compose(['ps', '-q', 'livekit']).trim();
  const output = execute('docker', [
    'run',
    '--rm',
    '--network',
    `container:${container}`,
    '--shm-size=1g',
    '--mount',
    `type=bind,source=${root},target=/workspace,readonly`,
    '--workdir',
    '/workspace/web',
    BROWSER_IMAGE,
    'node',
    '/workspace/scripts/check-calls-runtime.mjs',
    '--browser',
  ]);
  console.log(output);
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
        '--output',
        '/tmp/tg-chat-calls',
        'e2e-accounts/calls.spec.ts',
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
