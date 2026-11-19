// Tests for the CHANGELOG check npm's script shell runs before a bare root `npm test`:
// the linter WORKFLOW_DIR names is handed the changed CHANGELOG and judges only the
// lines it adds. Run through npm, since the check is no export. Its refusal and its
// stand-aside are test/scripts/script-shell-detached.test.js's.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const { shellPath } = require('../lib/platform');
const {
  cleanup, skipWithoutWrapper, mkRepo, mkWorld, npm,
} = require('../lib/script-shell');

const HEAD = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n';

describe('script-shell: the CHANGELOG check before a bare root run', { skip: skipWithoutWrapper() }, () => {
  test('WORKFLOW_DIR names the engine whose linter it runs', () => {
    const world = mkWorld();
    const engine = mkTmp('changelog-lint-engine-');
    const argvFile = path.join(engine, 'argv.json');
    fs.mkdirSync(path.join(engine, 'changelog'));
    fs.writeFileSync(path.join(engine, 'changelog', 'lint.js'), [
      `require('fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));`,
      "console.error('the stand-in linter said no');",
      'process.exit(1);',
    ].join('\n'));
    const repo = mkRepo({ scripts: { test: 'exit 0' } }, { 'CHANGELOG.md': HEAD });
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), `${HEAD}- [#4](https://github.com/o/r/issues/4) - A new entry.\n`);
    const out = npm(world, repo, ['test'], world.wrapper, { WORKFLOW_DIR: shellPath(engine) });
    expect(out.code, `the stand-in's failure is the answer, got: ${out.out}|${out.err}`).toBe(1);
    expect(out.err.includes('the stand-in linter said no'), `its words reach the message, got: ${out.err}`).toBeTruthy();
    const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
    expect(argv[0].replace(/\\/g, '/').endsWith('/CHANGELOG.md'), `it was handed the repo's CHANGELOG, got: ${argv}`).toBeTruthy();
    expect(JSON.stringify(argv.slice(1)), 'judging only the added lines').toBe('["--added-only"]');
    cleanup(world.root); cleanup(repo);
  });
});
