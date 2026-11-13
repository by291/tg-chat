import { writeFile } from 'node:fs/promises';

import { createRuntimeEnvironment, serializeEnvironment } from './runtime-environment.mjs';

const isDevelopment = process.argv.includes('--dev');
const environmentName = isDevelopment ? '.env.dev' : '.env';
const environmentPath = new URL(`../${environmentName}`, import.meta.url);
const environment = createRuntimeEnvironment();
if (isDevelopment) {
  environment.TG_CHAT_MEDIA_ENABLED = 'true';
}

try {
  await writeFile(environmentPath, serializeEnvironment(environment), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(`Created ${environmentName} with local-only credentials.`);
} catch (error) {
  if (error.code !== 'EEXIST') {
    throw error;
  }

  // The development supervisor can reuse its existing credentials on every launch.
  if (!isDevelopment) {
    console.error(
      '.env already exists; keep it or explicitly move it before creating another one.',
    );
    process.exitCode = 1;
  }
}
