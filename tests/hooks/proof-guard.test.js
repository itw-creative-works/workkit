//
// Tests for hooks/safety/proof-guard, the PreToolUse hook that holds the
// spec's proof gate (docs/project-state.md, "The proof", issue #233): a flip
// to `status:complete` and a `gh issue close` both need the issue to carry a
// comment whose line starts `Proof:`. A close of something never built
// (`--reason "not planned"`) passes, and an unreachable `gh` fails open.
//
// Every case runs against a PATH-shim `gh` that answers `issue view` from a
// fixture, so nothing here reaches GitHub.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'proof-guard', 'run.sh');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proof-guard-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// PATH shim: records each `gh` invocation and answers `issue view <N> --json
// comments` from a fixture keyed by issue number. `fails: true` makes every
// view exit non-zero, the way an unauthenticated or offline gh does.
const makeGhStub = ({ comments = {}, fails = false } = {}) => {
  const dir = mkTmp();
  const logFile = path.join(dir, 'gh.log');
  const bodiesDir = path.join(dir, 'issues');
  fs.mkdirSync(bodiesDir, { recursive: true });
  for (const [number, bodies] of Object.entries(comments)) {
    fs.writeFileSync(path.join(bodiesDir, `${number}.json`),
      JSON.stringify({ comments: bodies.map((body) => ({ body })) }));
  }
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const cwdFile = path.join(dir, 'cwd');
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    `printf '%s\\n' "$PWD" >> "${cwdFile}"`,
    'if [[ "$1 $2" == "issue view" ]]; then',
    ...(fails ? ['  exit 1'] : [
      `  file="${bodiesDir}/$3.json"`,
      '  [[ -f "$file" ]] || exit 1',
      '  cat "$file"',
      '  exit 0',
    ]),
    'fi',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  return { binDir: path.join(dir, 'bin'), logFile, cwdFile, dir };
};

const ghCalls = (stub) => readArgv(stub.logFile);

const runHook = (command, stub, cwd = os.tmpdir()) => {
  const input = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const res = spawnSync('bash', [HOOK], {
    input,
    env: {
      HOME: os.homedir(),
      PATH: stub ? `${stub.binDir}:${BASE_PATH}` : BASE_PATH,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

// One issue with a proof, one without, in every world.
const WORLD = { comments: { 7: ['Proof: unit: node tests/hooks/x.test.js'], 9: ['looks good to me'] } };

const run = async () => {
  group('proof-guard: the flip to status:complete');

  await test('no Proof: comment, exit 2, naming the issue and the fix', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 9 --remove-label status:qa --add-label status:complete', stub);
    assertEq(code, 2, 'a complete flip with no proof must block');
    assert(stderr.includes('proof-guard'), 'names itself');
    assert(stderr.includes('#9'), `names the issue, got: ${stderr}`);
    assert(stderr.includes('Proof:'), 'names what is missing');
    assert(stderr.includes('skills/feature/SKILL.md'), 'names where the proof is written');
    const calls = ghCalls(stub);
    assertEq(calls.length, 1, `exactly one gh call, got: ${fmtCalls(calls)}`);
    assert(isCall(calls[0], 'issue', 'view', '9', '--json', 'comments'), `the comments read, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('a Proof: comment, exit 0', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 7 --remove-label status:qa --add-label status:complete', stub);
    assertEq(code, 0, `a proved item flips, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('the Proof: line inside a longer comment counts', () => {
    const stub = makeGhStub({ comments: { 4: ['what to check: the board page\n\nProof: unit: node tests/x.js'] } });
    assertEq(runHook('gh issue edit 4 --add-label status:complete', stub).code, 0, 'any line may open with it');
    cleanup(stub.dir);
  });

  await test('a separator inside a quoted value never cuts the clause', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 9 --body "a; b" --add-label status:complete',
      'gh issue edit 9 --body "why it matters | how" --add-label status:complete',
      'gh issue edit 9 --body "don\'t; ship" --add-label status:complete',
    ]) {
      assertEq(runHook(c, stub).code, 2, `the quoted span is data, not a clause break: ${c}`);
    }
    cleanup(stub.dir);
  });

  await test('a long table body stays fast, gated and ungated alike', () => {
    // The clause walk is one pass over the command (issue #233, verifier
    // finding): a body full of `|` rows used to be re-scanned once per
    // fragment, which took seconds. An ungated edit never reaches the walk at
    // all, since neither `status:complete` nor `gh issue close` is in the text.
    const stub = makeGhStub(WORLD);
    const body = ['| a | b | c |', '|---|---|---|',
      ...Array.from({ length: 100 }, (_, i) => `| row ${i} | value ${i} | note ${i} |`)].join('\n');
    const started = Date.now();
    assertEq(runHook(`gh issue edit 9 --body "${body}" --add-label status:complete`, stub).code, 2,
      'the unproved issue still bounces, table body and all');
    const gated = Date.now() - started;
    assert(gated < 1000, `the gated command answers in under a second, took ${gated}ms`);

    const startedOther = Date.now();
    assertEq(runHook(`gh issue edit 9 --body "${body}" --add-label status:qa`, stub).code, 0,
      'an ungated edit passes');
    const ungated = Date.now() - startedOther;
    assert(ungated < 1000, `the ungated command answers in under a second, took ${ungated}ms`);
    cleanup(stub.dir);
  });

  await test('a label list carrying status:complete blocks too', () => {
    const stub = makeGhStub(WORLD);
    assertEq(runHook('gh issue edit 9 --add-label "type:bug,status:complete"', stub).code, 2,
      'the label is read out of the list');
    cleanup(stub.dir);
  });

  await test('any other label flip is not this gate: exit 0, no gh call', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 9 --remove-label status:building --add-label status:qa',
      'gh issue edit 9 --remove-label status:complete --add-label status:qa',
      'gh issue edit 9 --add-assignee @me',
    ]) {
      assertEq(runHook(c, stub).code, 0, `must pass: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `no issue is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  group('proof-guard: the close');

  await test('closing an issue with no Proof: comment, exit 2', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue close 9 --comment "shipped in 0.54.0"', stub);
    assertEq(code, 2, 'a close with no proof must block');
    assert(stderr.includes('be closed'), `names what it blocked, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('closing a proved issue, exit 0', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue close 7', stub);
    assertEq(code, 0, `a proved item closes, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('--reason "not planned" passes, in every quoting', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue close 9 --reason "not planned"',
      "gh issue close 9 --reason 'not planned'",
      'gh issue close 9 --reason=not\\ planned',
      'gh issue close 9 -r "not planned"',
      'gh issue close 9 --duplicate-of 7',
    ]) {
      assertEq(runHook(c, stub).code, 0, `nothing was built, so nothing is proved: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `a never-built close reads nothing, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test('--reason completed is gated like a bare close', () => {
    const stub = makeGhStub(WORLD);
    assertEq(runHook('gh issue close 9 --reason completed', stub).code, 2, 'completed means built');
    cleanup(stub.dir);
  });

  group('proof-guard: scope and cross-repo');

  await test('unrelated gh commands: exit 0, no gh call', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue list --label status:complete',
      'gh issue view 9 --json comments',
      'gh issue comment 9 --body "Proof: unit: node tests/x.js"',
      'gh pr merge 9 --squash',
      'echo "gh issue close 9"',
    ]) {
      assertEq(runHook(c, stub).code, 0, `must pass: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `nothing is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test('--repo rides the read in every spelling, so a cross-repo flip asks its own issue', () => {
    for (const flag of ['--repo owner/name', '--repo=owner/name', '-R owner/name', '-Rowner/name', '--repo "owner/name"']) {
      const stub = makeGhStub(WORLD);
      const { code } = runHook(`gh issue edit 9 ${flag} --add-label status:complete`, stub);
      assertEq(code, 2, `the issue is still unproved: ${flag}`);
      const calls = ghCalls(stub);
      assert(isCall(calls[0], 'issue', 'view', '9', '--repo', 'owner/name', '--json', 'comments'),
        `the repo is forwarded for ${flag}, got: ${fmtCalls(calls)}`);
      cleanup(stub.dir);
    }
  });

  await test('a --repo value the guard cannot read stands the gate down, never reads the local repo', () => {
    for (const c of [
      'gh issue close 9 --repo "$TARGET_REPO"',
      'gh issue edit 9 -R "$(gh repo view --json nameWithOwner -q .nameWithOwner)" --add-label status:complete',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 0, `an unreadable repo fails open: ${c}`);
      assert(stderr.includes('did not run'), `says the gate stood down, got: ${stderr}`);
      assertEq(ghCalls(stub).length, 0, `the local repo is never asked instead, got: ${fmtCalls(ghCalls(stub))}`);
      cleanup(stub.dir);
    }
  });

  await test('every issue in a compound is judged', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue close 7 && gh issue close 9', stub);
    assertEq(code, 2, 'the unproved half of the compound blocks it');
    assert(stderr.includes('#9'), `names the unproved one, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test("the read runs from the session's directory, where the command would", () => {
    const stub = makeGhStub(WORLD);
    const here = fs.realpathSync(mkTmp());
    assertEq(runHook('gh issue close 9', stub, here).code, 2, 'the unproved issue still blocks');
    assertEq(fs.readFileSync(stub.cwdFile, 'utf8').trim(), here,
      'an issue number with no --repo resolves against the session directory, so the read asks from there');
    cleanup(here);
    cleanup(stub.dir);
  });

  group('proof-guard: wiring and fail-open');

  await test('hooks.json registers the guard under PreToolUse Bash', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    assert(bash.hooks.some((h) => h.command.includes('safety:proof-guard')),
      'the Bash block routes safety:proof-guard through the loader');
  });

  await test('gh not on PATH: exit 0, and says the gate did not run', () => {
    const { code, stderr } = runHook('gh issue close 9', null);
    assertEq(code, 0, 'an unreachable gh never wedges the session');
    assert(stderr.includes('proof-guard'), 'names itself');
    assert(stderr.includes('did not run'), `says the gate stood down, got: ${stderr}`);
  });

  await test('a gh view that fails: exit 0, and says the gate did not run', () => {
    const stub = makeGhStub({ fails: true });
    const { code, stderr } = runHook('gh issue edit 9 --add-label status:complete', stub);
    assertEq(code, 0, 'a failing view fails open');
    assert(stderr.includes('did not run'), `says the gate stood down, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('missing command, exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: {} }),
      env: { HOME: os.homedir(), PATH: BASE_PATH },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'no command means fail open');
  });

  await test('malformed JSON, exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: 'not json',
      env: { HOME: os.homedir(), PATH: BASE_PATH },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'bad input means fail open');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
