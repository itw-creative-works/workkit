// Tests for standards.sh: the hook layer self-check, over a layer with no loader:
// the hooks module and the shell pieces the scripts still source.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  SYSTEM_BASH, NO_RC, shellPath, stubTool, joinPath,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, SCRIPT, cleanup, makeRepo, makeGhStub, binDirWithout, runScript,
} = require('./helpers');

const cases = async () => {
  group('standards.sh: the hook layer self-check');

  // Every guard fails open by design, so a module that cannot load, a shell
  // piece with a syntax error, or a missing tool disables a safety layer with
  // nothing watching. This is the once-a-day assertion that the layer is alive.

  // badPieces: shell pieces (paths under the hooks dir) written with a syntax
  // error; badModule: the hooks module, register.js, written with one.
  const makeHooksDir = ({ badPieces = [], badModule = false } = {}) => {
    const dir = mkTmp('wf-std-');
    fs.writeFileSync(path.join(dir, 'register.js'), badModule
      ? 'export function register(on {\n'
      : 'export function register(on) {}\n');
    fs.writeFileSync(path.join(dir, 'hooks.json'), `${JSON.stringify({ modules: ['./register.js'] }, null, 2)}\n`);
    for (const piece of ['_lib.sh', 'lib/markers.sh']) {
      fs.mkdirSync(path.dirname(path.join(dir, piece)), { recursive: true });
      fs.writeFileSync(path.join(dir, piece), '#!/bin/bash\nhook_ok() { :; }\n');
    }
    for (const piece of badPieces) {
      fs.mkdirSync(path.dirname(path.join(dir, piece)), { recursive: true });
      fs.writeFileSync(path.join(dir, piece), 'if [ 1 ; then\n');
    }
    return dir;
  };

  await test('a healthy hook layer with no loader passes and says nothing at all', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('⚠'), `a live layer is not news, and no loader is no fault, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('the real shipped hook layer passes its own check', () => {
    // The fixtures below prove the check catches things; this proves the kit
    // being shipped is not one of them.
    const repo = makeRepo();
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('⚠'), `the module loads and every shell piece parses, got: ${output}`);
    assert(output.includes('the hooks module loads'), `and the module is named as loading, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the shipped hooks module imports as ESM with no module-type warning', () => {
    // The self-check passes --no-warnings, and an older node fails a typeless
    // import outright, so this import is plain node, warnings and all.
    const registerJs = path.join(WORKFLOW_DIR, '..', 'hooks', 'register.js');
    const res = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', 'const { pathToFileURL } = await import("node:url"); await import(pathToFileURL(process.argv[1]).href);',
      registerJs,
    ], { encoding: 'utf8', timeout: SPAWN_DEADLINE });
    assertEq(res.status, 0, `the module imports, stderr: ${res.stderr}`);
    assert(!res.stderr.includes('MODULE_TYPELESS'), `and node knows its type up front, got: ${res.stderr}`);
  });

  await test('a hooks module that does not load is flagged, with its first stderr line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ badModule: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'a module that cannot load is a dead safety layer: attention is set');
    const line = output.split('\n').find((l) => l.includes('hooks: the hooks module fails to load:')) || '';
    assert(line, `the flag line names the module, got: ${output}`);
    assert(line.replace(/.*hooks: the hooks module fails to load:/, '').trim().length > 0, `and carries a stderr line, got: ${line}`);
    assert(!output.includes('; the hooks module loads'), `and the summary does not call it loaded, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  for (const piece of ['_lib.sh', 'lib/broken.sh']) {
    await test(`a staying shell piece that does not parse is named and marks the run unfinished: ${piece}`, () => {
      const repo = makeRepo();
      const stub = makeGhStub();
      const hooks = makeHooksDir({ badPieces: [piece] });
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
      assertEq(code, 1, 'reported as unfinished');
      assert(output.includes(`${piece} has a syntax error`), `names the piece, got: ${output}`);
      cleanup(repo); cleanup(stub.dir); cleanup(hooks);
    });
  }

  await test('a digest tool under either name satisfies the check (workkit #245)', () => {
    // hook_sha1 takes shasum or sha1sum, so the daily heal asks for the pair:
    // a Linux machine with only sha1sum is whole, and a machine with neither
    // is told both names.
    const repo = makeRepo();
    const hooks = makeHooksDir();
    const stub = makeGhStub();
    const binDir = binDirWithout('shasum');
    fs.rmSync(path.join(binDir, 'sha1sum'), { force: true });
    const check = () => {
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
        env: {
          PATH: joinPath(stub.binDir, binDir),
          WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
          WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
          WORKFLOW_HOOKS_DIR: shellPath(hooks),
        },
        encoding: 'utf8',
        timeout: SPAWN_DEADLINE,
      });
      return (res.stdout || '') + (res.stderr || '');
    };
    const neither = check();
    assert(/hooks: the hook layer needs.*shasum or sha1sum/.test(neither), `names both digest tools, got: ${neither}`);
    stubTool(binDir, 'sha1sum', ['#!/bin/sh', 'exit 0']);
    const one = check();
    assert(!/hook layer needs/.test(one), `sha1sum alone satisfies the pair, got: ${one}`);
    cleanup(repo); cleanup(hooks); cleanup(binDir); cleanup(stub.dir);
  });

  await test('an engine installed without a hook layer beside it checks nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const empty = mkTmp('wf-std-');
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: empty });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('hooks:'), `no hooks.json means no hook layer to judge, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(empty);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
