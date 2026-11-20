import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { verifyCallBrowsers } from './check-calls-runtime.mjs';

/** Emulate an external browser writing through its bind mount before reporting failure. */
function failingBrowser(argumentsList) {
  const mount = argumentsList.find((argument) => {
    return argument.endsWith(',target=/workspace/web/test-results');
  });
  assert.ok(mount, 'The disposable browser needs a writable artifact mount.');
  const source = mount.split(',').find((field) => field.startsWith('source='));
  assert.ok(source);
  const directory = join(source.slice('source='.length), 'calls');
  const settingsIndex = argumentsList.indexOf('--env-file');
  assert.ok(settingsIndex >= 0);
  const settingsPath = argumentsList[settingsIndex + 1];
  assert.ok(readFileSync(settingsPath, 'utf8').length > 0);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'failure-trace.zip'), 'browser diagnostic bytes');
  return settingsPath;
}

test('retains browser failure artifacts while removing disposable provider credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'tg-chat-call-artifacts-'));
  let settingsPath;
  try {
    assert.throws(
      () =>
        verifyCallBrowsers({
          root,
          compose: (argumentsList) => {
            return argumentsList[0] === 'ps' ? 'disposable-provider' : '';
          },
          execute: (_command, argumentsList) => {
            settingsPath = failingBrowser(argumentsList);
            throw new Error('The browser workflow failed.');
          },
        }),
      /The browser workflow failed/,
    );

    const artifact = join(root, 'web', 'test-results', 'calls', 'failure-trace.zip');
    assert.equal(readFileSync(artifact, 'utf8'), 'browser diagnostic bytes');
    assert.ok(settingsPath);
    assert.equal(existsSync(dirname(settingsPath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
