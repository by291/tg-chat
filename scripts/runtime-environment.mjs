import { randomBytes } from 'node:crypto';

const SECRET_BYTES = 32;
const ACCESS_KEY_BYTES = 16;

/** Generate isolated local credentials without embedding usable secrets in repository files. */
export function createRuntimeEnvironment({ httpPort = '8080', s3Port = '8333' } = {}) {
  return {
    TG_CHAT_MAIL_KEY: randomBytes(SECRET_BYTES).toString('base64'),
    TG_CHAT_DATABASE_PASSWORD: randomBytes(SECRET_BYTES).toString('hex'),
    TG_CHAT_CENTRIFUGO_PROXY_KEY: randomBytes(SECRET_BYTES).toString('hex'),
    TG_CHAT_CENTRIFUGO_API_KEY: randomBytes(SECRET_BYTES).toString('hex'),
    TG_CHAT_S3_ACCESS_KEY: randomBytes(ACCESS_KEY_BYTES).toString('hex'),
    TG_CHAT_S3_SECRET_KEY: randomBytes(SECRET_BYTES).toString('hex'),
    TG_CHAT_HTTP_PORT: httpPort,
    TG_CHAT_S3_PORT: s3Port,
    TG_CHAT_PUBLIC_ORIGIN: `http://localhost:${httpPort}`,
    TG_CHAT_S3_INTERNAL_ENDPOINT: 'http://seaweedfs:8333',
    TG_CHAT_S3_PUBLIC_ENDPOINT: `http://localhost:${s3Port}`,
    TG_CHAT_LOG_LEVEL: 'info',
  };
}

/** Serialize generated values as a Compose environment file without logging them. */
export function serializeEnvironment(environment) {
  const lines = [];

  for (const [name, value] of Object.entries(environment)) {
    lines.push(`${name}=${value}`);
  }

  return `${lines.join('\n')}\n`;
}
