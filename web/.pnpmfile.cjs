/** Keep the generator's JavaScript compiler API independent from the application's compiler. */
function readPackage(manifest) {
  if (manifest.name !== 'openapi-typescript') {
    return manifest;
  }

  // TypeScript 7 ships the application compiler without the JavaScript factory API this tool uses.
  // A peer override still resolves to the root compiler after installs; make this a private dependency.
  const peerDependencies = { ...manifest.peerDependencies };
  delete peerDependencies.typescript;

  return {
    ...manifest,
    peerDependencies,
    dependencies: {
      ...manifest.dependencies,
      typescript: '5.9.3',
    },
  };
}

module.exports = { hooks: { readPackage } };
