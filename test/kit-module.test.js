// Tests for packages/core/test/lib/kit-module.js: kitModule(stem) loads the kit's
// workflow/lib/<stem>.js only in the kit's own checkout, and the packed <stem>.cjs
// at the package's root anywhere else, so a consumer repo's own workflow/lib file
// never becomes the package's program starter.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp, run } = require('./lib/harness');

const KIT = path.join(__dirname, '..');
const CORE = path.join(KIT, 'packages', 'core');

// Prints the file kitModule('run') loaded, found in the require cache by its exports.
const WHICH_FILE = (kitModulePath) => `
  const { kitModule } = require(${JSON.stringify(kitModulePath)});
  const loaded = kitModule('run');
  process.stdout.write(Object.keys(require.cache).find((file) => require.cache[file].exports === loaded) || 'none');
`;

// One spelling per file, so a Windows short name or drive case never splits the two sides.
const real = (file) => fs.realpathSync.native(file);

/** The file kitModule('run') gives in the package copy at `packageRoot`, asked in a child node. */
const loadedRun = (packageRoot) => {
  const res = run(process.execPath, ['-e', WHICH_FILE(path.join(packageRoot, 'test', 'lib', 'kit-module.js'))]);
  expect(res.status, `the child answered, stderr: ${res.stderr}`).toBe(0);
  expect(res.stdout, 'the child found the loaded file').not.toBe('none');
  return real(res.stdout);
};

/**
 * A consumer repo of another name holding its own workflow/lib/run.js, with the
 * package installed at node_modules/workkit-core as a pack leaves it: run.cjs a
 * copy of the kit's run.js.
 */
const consumerRepo = () => {
  const repo = mkTmp('kit-module-');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  fs.mkdirSync(path.join(repo, 'workflow', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'workflow', 'lib', 'run.js'), "module.exports = { marker: 'consumer' };\n");
  const installed = path.join(repo, 'node_modules', 'workkit-core');
  fs.cpSync(CORE, installed, { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' });
  fs.copyFileSync(path.join(KIT, 'workflow', 'lib', 'run.js'), path.join(installed, 'run.cjs'));
  return { repo, installed };
};

describe('kitModule', () => {
  test("an installed package loads its packed run.cjs, never the consumer repo's own workflow/lib/run.js", () => {
    const { installed } = consumerRepo();
    expect(loadedRun(installed), 'the packed copy').toBe(real(path.join(installed, 'run.cjs')));
  });

  test("in the kit's own checkout it loads the kit's workflow/lib/run.js", () => {
    expect(loadedRun(CORE), "the kit's file").toBe(real(path.join(KIT, 'workflow', 'lib', 'run.js')));
  });
});
