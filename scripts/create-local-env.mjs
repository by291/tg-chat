import { writeFile } from 'node:fs/promises';

import { createRuntimeEnvironment, serializeEnvironment } from './runtime-environment.mjs';

const environmentPath = new URL('../.env', import.meta.url);
const environment = createRuntimeEnvironment();

try {
  await writeFile(environmentPath, serializeEnvironment(environment), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(
    'Created .env with local-only credentials. Existing environments are never overwritten.',
  );
} catch (error) {
  if (error.code !== 'EEXIST') {
    throw error;
  }

  console.error('.env already exists; keep it or explicitly move it before creating another one.');
  process.exitCode = 1;
}
