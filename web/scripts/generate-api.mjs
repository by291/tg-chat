import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OPENAPI_PATH = new URL('../../openapi/api.json', import.meta.url);
const TYPES_PATH = new URL('../src/api/schema.d.ts', import.meta.url);
const isCheck = process.argv.includes('--check');

async function saveOrCheck(path, content) {
  if (isCheck) {
    const current = await readFile(path, 'utf8');

    if (current !== content) {
      throw new Error(`Contract drift in ${fileURLToPath(path)}; run pnpm api:generate.`);
    }

    return;
  }

  await writeFile(path, content);
}

async function main() {
  const exported = execFileSync(
    'cargo',
    // prettier-ignore
    [
      'run',
      '--locked',
      '--quiet',
      '--bin',
      'api',
      '--',
      'openapi',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      // Keep compiler diagnostics outside the JSON contract stream.
      // prettier-ignore
      stdio: [
        'ignore',
        'pipe',
        'inherit',
      ],
    },
  );
  const document = JSON.parse(exported);
  const syntaxTree = await openapiTS(document);
  const configuration = await resolveConfig(fileURLToPath(TYPES_PATH));
  const generatedSource =
    '// Generated from the Rust OpenAPI contract. Run pnpm api:generate.\n' +
    astToString(syntaxTree);
  const types = await format(generatedSource, { ...configuration, parser: 'typescript' });
  const contract = await format(JSON.stringify(document), { ...configuration, parser: 'json' });

  await saveOrCheck(OPENAPI_PATH, contract);
  await saveOrCheck(TYPES_PATH, types);
  console.log(isCheck ? 'API contracts are current.' : 'API contracts generated.');
}

await main();
