// Tests for standards.js: the hook layer self-check, over a layer with no loader:
// the hooks module and the tools the layer needs.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  WORKFLOW_DIR, cleanup, makeRepo, makeGhStub, runScript,
} = require('./helpers');

describe('standards.js: the hook layer self-check', () => {
  // Every guard fails open by design, so a module that cannot load or a
  // missing tool disables a safety layer with nothing watching. This is the
  // once-a-day assertion that the layer is alive.

  // badModule: the hooks module, register.js, written with a syntax error.
  const makeHooksDir = ({ badModule = false } = {}) => {
    const dir = mkTmp('wf-std-');
    fs.writeFileSync(path.join(dir, 'register.js'), badModule
      ? 'export function register(on {\n'
      : 'export function register(on) {}\n');
    fs.writeFileSync(path.join(dir, 'hooks.json'), `${JSON.stringify({ modules: ['./register.js'] }, null, 2)}\n`);
    return dir;
  };

  test('a healthy hook layer with no loader: the one line hooks: the hooks module loads, exit 0, no flag', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    expect(code, 'exit 0').toBe(0);
    expect(!output.includes('⚠'), `a live layer is not news, and no loader is no fault, got: ${output}`).toBeTruthy();
    // Each line naming the module, from its `hooks: ` on, past the mark the voice puts before it.
    const said = output.split('\n').filter((l) => l.includes('hooks module')).map((l) => l.slice(l.indexOf('hooks: ')).trimEnd());
    expect(JSON.stringify(said), `the one line, got: ${output}`).toBe(JSON.stringify(['hooks: the hooks module loads']));
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  test('the real shipped hook layer passes its own check', () => {
    // The fixtures below prove the check catches things; this proves the kit
    // being shipped is not one of them.
    const repo = makeRepo();
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit 0').toBe(0);
    expect(!output.includes('⚠'), `the module loads and every tool is here, got: ${output}`).toBeTruthy();
    expect(output.includes('the hooks module loads'), `and the module is named as loading, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('the shipped hooks module imports as ESM with no module-type warning', () => {
    // The self-check passes --no-warnings, and an older node fails a typeless
    // import outright, so this import is plain node, warnings and all.
    const registerJs = path.join(WORKFLOW_DIR, '..', 'hooks', 'register.js');
    const res = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', 'const { pathToFileURL } = await import("node:url"); await import(pathToFileURL(process.argv[1]).href);',
      registerJs,
    ], { encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `the module imports, stderr: ${res.stderr}`).toBe(0);
    expect(!res.stderr.includes('MODULE_TYPELESS'), `and node knows its type up front, got: ${res.stderr}`).toBeTruthy();
  });

  test('a hooks module that does not load is flagged, with its first stderr line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ badModule: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    expect(code, 'a module that cannot load is a dead safety layer: attention is set').toBe(1);
    const line = output.split('\n').find((l) => l.includes('hooks: the hooks module fails to load:')) || '';
    expect(line, `the flag line names the module, got: ${output}`).toBeTruthy();
    expect(line.replace(/.*hooks: the hooks module fails to load:/, '').trim().length > 0, `and carries a stderr line, got: ${line}`).toBeTruthy();
    expect(!output.includes('the hooks module loads'), `and no line calls it loaded, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  test('an engine installed without a hook layer beside it checks nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const empty = mkTmp('wf-std-');
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: empty });
    expect(code, 'exit 0').toBe(0);
    expect(!/(?<!git )hooks:/.test(output), `no hooks.json means no hook layer to judge, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir); cleanup(empty);
  });
});
