//
// Tests for hooks/workflow:standards: healing a repo, and relaying only the
// lines the engine itself printed.
// The shared prologue (the repo factory, the decline, the hook runner and its gh-less PATH, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { BASH, NO_RC, shellPath, homeEnv } = require('../../lib/platform');
const {
  HOOK, WORKFLOW_DIR, BASE_PATH, IGNORE_GLOB, mkTmp, cleanup, makeRepo, runHook, dropPathWithoutGh,
} = require('./helpers');

const run = async () => {
  group('workflow:standards: healing a repo');

  await test('unstandardized repo: heals it and reports what changed', () => {
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'issue templates installed');
    assert(IGNORE_GLOB.test(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')), `${W}/ ignored`);
    const parsed = JSON.parse(stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'SessionStart', 'SessionStart context');
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('issue forms'), `reports the forms, got: ${ctx}`);
    assert(ctx.includes('gitignore'), `reports the gitignore heal, got: ${ctx}`);
    assert(!ctx.includes('['), 'ANSI colors stripped');
    cleanup(repo); cleanup(cacheDir);
  });

  await test('already-standardized repo: silent (skips are not news)', () => {
    const repo = makeRepo();
    const first = runHook(repo);
    assert(first.stdout.length > 0, 'first run reported the heals');
    // Fresh cache dir: this is the "different day" run, not the cached one.
    const second = runHook(repo);
    assertEq(second.code, 0, 'exit 0');
    assertEq(second.stdout, '', `an all-skip run stays silent, got: ${second.stdout}`);
    cleanup(repo); cleanup(first.cacheDir); cleanup(second.cacheDir);
  });

  // What the relay carries, and what it must not (issue #237). The heal's
  // capture is BOTH streams, so a child tool the engine ran writes into it too:
  // a `cp` refusal, a git advisory. Only a line the engine itself printed is a
  // heal action, and the opening glyph is what says which is which.
  await test('a raw line from a child tool is not relayed as a heal action', () => {
    const engine = mkTmp();
    fs.writeFileSync(path.join(engine, 'labels.json'), '{ "version": 1, "groups": {} }\n');
    fs.writeFileSync(path.join(engine, 'standards.sh'), [
      '#!/usr/bin/env bash',
      "if [[ \"$1\" == '--state' ]]; then printf 'enabled\\n'; exit 0; fi",
      // One action in the engine's voice, and one line a child tool wrote for
      // itself.
      "printf '  \\xe2\\x9c\\x93 gitignore: added .workkit/*\\n' >&2",
      "printf 'cp: /nowhere/thing: No such file or directory\\n' >&2",
      '',
    ].join('\n'));
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'exit 0');
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert(ctx.includes('gitignore: added'), `the engine's own line is relayed, got: ${ctx}`);
    assert(!ctx.includes('cp:'), `and the child tool's is not, got: ${ctx}`);
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  await test("the relay's pattern matches a line the engine really prints", () => {
    // The one place this hook restates the engine's line shape. Read the
    // pattern out of the hook itself and put a REAL logger line through it, so
    // the two can never drift apart in silence.
    const pattern = fs.readFileSync(HOOK, 'utf8').match(/grep -E '(\^\[\[:space:\]\]\*[^']+)'/);
    assert(pattern, 'the hook filters on a glyph pattern');
    const lib = shellPath(path.join(WORKFLOW_DIR, 'lib.sh'));
    const said = spawnSync(BASH, [...NO_RC, '-c',
      `. ${JSON.stringify(lib)}; WK_LOG_INDENT='  '; WK_LOG_STDERR=1 wk_ok 'engine: linked a → b' 2>&1 | grep -E ${JSON.stringify(pattern[1])}`,
    ], { encoding: 'utf8', env: homeEnv(mkTmp(), { PATH: BASE_PATH, WORKKIT_COLOR: '0' }) });
    assertEq(said.status, 0, `the pattern matched, got: ${JSON.stringify(said.stdout)}`);
    assert(/engine: linked a → b$/.test(said.stdout.trim()), `on the whole line, got: ${JSON.stringify(said.stdout)}`);
  });

  await test('a subdirectory session resolves to the repo root', () => {
    const repo = makeRepo();
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    // settings.json sits at the ROOT: the gate reads the resolved root, not the cwd.
    const { cacheDir } = runHook(nested);
    assert(fs.existsSync(path.join(repo, '.gitignore')), 'root healed');
    assert(!fs.existsSync(path.join(nested, '.gitignore')), 'nothing written in the subdirectory');
    cleanup(repo); cleanup(cacheDir);
  });

  dropPathWithoutGh();
  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
