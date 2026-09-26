//
// Tests for standards.sh: the hook layer self-check.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_BASH, NO_RC, NO_EXEC_BIT, shellPath, stubTool, joinPath,
} = require('../../lib/platform');
const {
  SCRIPT, mkTmp, cleanup, makeRepo, makeGhStub, binDirWithout, runScript,
} = require('./helpers');

const run = async () => {
  // A case that STRIPS a file's executable bit to see what the heal says about
  // it. There is no bit to strip on Windows, so the whole case is the skip.
  const strippedBitTest = testUnless(IS_WINDOWS, `${NO_EXEC_BIT}, so no script can be stripped of one`);

  group('standards.sh: the hook layer self-check');

  // Every hook fails open by design, so a chmod-stripped script, a syntax
  // error, or a missing tool disables a safety layer with nothing watching.
  // This is the once-a-day assertion that the layer is alive.
  const HOOK_NAMES = ['docs:one', 'safety:two'];
  const makeHooksDir = ({ missing = [], notExecutable = [], badSyntax = [] } = {}) => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'hooks.json'), `${JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: HOOK_NAMES.map((n) => ({
            type: 'command',
            command: `"\${CLAUDE_PLUGIN_ROOT}"/hooks/loader.sh ${n}`,
          })),
        }],
      },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'loader.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    for (const name of HOOK_NAMES) {
      if (missing.includes(name)) continue;
      const hookDir = path.join(dir, ...name.split(':'));
      fs.mkdirSync(hookDir, { recursive: true });
      fs.writeFileSync(
        path.join(hookDir, 'run.sh'),
        badSyntax.includes(name) ? '#!/bin/bash\nif [ 1 ; then\n' : '#!/bin/bash\nexit 0\n',
        { mode: notExecutable.includes(name) ? 0o644 : 0o755 },
      );
    }
    return dir;
  };

  await test('a healthy hook layer says nothing at all', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('⚠'), `a live layer is not news, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('the real shipped hook layer passes its own check', () => {
    // The fixtures below prove the check catches things; this proves the kit
    // being shipped is not one of them.
    const repo = makeRepo();
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('⚠'), `every wired hook resolves and parses, got: ${output}`);
    assert(/hooks: \d+ hook scripts resolve/.test(output),
      `and the count is a skip line, which the session never sees, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await strippedBitTest('a chmod-stripped hook script is named, with the chmod that fixes it', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ notExecutable: ['safety:two'] });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'a dead safety layer is not a standardized repo');
    assert(output.includes('safety:two is not executable'), `names the hook, got: ${output}`);
    assert(output.includes('chmod +x'), `and the fix, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('a hook wired with no script behind it is named', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ missing: ['docs:one'] });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'reported as unfinished');
    assert(output.includes('docs:one is wired in hooks.json'), `names the hook, got: ${output}`);
    assert(output.includes('reinstall'), `and what to do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('a hook script that does not parse is named', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir({ badSyntax: ['docs:one'] });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'reported as unfinished');
    assert(output.includes('docs:one has a syntax error'), `names the hook, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await strippedBitTest('the loader itself is checked: nothing runs without it', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const hooks = makeHooksDir();
    fs.chmodSync(path.join(hooks, 'loader.sh'), 0o644);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: hooks });
    assertEq(code, 1, 'reported as unfinished');
    assert(output.includes('loader.sh is not executable'), `names the router, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(hooks);
  });

  await test('a missing tool is named loudly, without holding the repo back', () => {
    // A tool the machine lacks is not the repo's fault, so it warns like
    // everything else here but never flags the run: the version stamp and the
    // drift report must not wait on something no repo can install for it.
    const repo = makeRepo();
    const hooks = makeHooksDir();
    const stub = makeGhStub();
    const binDir = binDirWithout('node');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: {
        PATH: joinPath(stub.binDir, binDir),
        WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
        WORKFLOW_HOOKS_DIR: shellPath(hooks),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'a machine condition never fails the run');
    assert(/hooks: the hook layer needs.*node/.test(out), `names the missing tool, got: ${out}`);
    assert(out.includes('silently do not run'), `and what its absence costs, got: ${out}`);
    cleanup(repo); cleanup(hooks); cleanup(binDir); cleanup(stub.dir);
  });

  await test('a digest tool under either name satisfies the check (workkit #245)', () => {
    // hook_sha1 takes shasum or sha1sum, so the daily heal asks for the pair:
    // a Linux machine with only sha1sum is whole, and a machine with neither
    // is told both names.
    const repo = makeRepo();
    const hooks = makeHooksDir();
    const stub = makeGhStub();
    const binDir = binDirWithout('shasum');
    fs.rmSync(path.join(binDir, 'sha1sum'), { force: true });
    const run = () => {
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
        env: {
          PATH: joinPath(stub.binDir, binDir),
          WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
          WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
          WORKFLOW_HOOKS_DIR: shellPath(hooks),
        },
        encoding: 'utf8',
        timeout: 20000,
      });
      return (res.stdout || '') + (res.stderr || '');
    };
    const neither = run();
    assert(/hooks: the hook layer needs.*shasum or sha1sum/.test(neither), `names both digest tools, got: ${neither}`);
    stubTool(binDir, 'sha1sum', ['#!/bin/sh', 'exit 0']);
    const one = run();
    assert(!/hook layer needs/.test(one), `sha1sum alone satisfies the pair, got: ${one}`);
    cleanup(repo); cleanup(hooks); cleanup(binDir); cleanup(stub.dir);
  });

  await test('an engine installed without a hook layer beside it checks nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const empty = mkTmp();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, hooksDir: empty });
    assertEq(code, 0, 'exit 0');
    assert(!output.includes('hooks:'), `no hooks.json means no hook layer to judge, got: ${output}`);
    cleanup(repo); cleanup(stub.dir); cleanup(empty);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
