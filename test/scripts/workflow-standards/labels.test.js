// Tests for standards.js: the label heal and the open-issue label report.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, mkTmp, start, until,
} = require('../../lib/harness');
const {
  gitPath, joinPath, skipWithoutNodeStub, shellPath, stubTool, SYSTEM_PATH, NODE_DIR,
} = require('../../lib/platform');
const { isCall, eqArgv, fmtCalls } = require('../../lib/argv-log');
const { PTY, atTerminal } = require('../../lib/identity');
const { framesIn, CLEAR } = require('../../lib/spin-call');
const {
  SCRIPT, WORKFLOW_DIR, copyKitSiblings, desiredLabels, cleanup, makeRepo, makeGhStub, ghCalls, seededEnv, heal, runScript,
} = require('./helpers');

// The repo a gh call names by flag, '' for the cwd's own.
const target = (c) => {
  const at = c.findIndex((a) => a === '-R' || a === '--repo');
  if (at !== -1) return c[at + 1];
  const inline = c.find((a) => a.startsWith('--repo='));
  return inline ? inline.slice('--repo='.length) : '';
};

describe('standards.js: labels', () => {
  test('creates every manifest label with its description and color', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [] });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit 0').toBe(0);
    const calls = ghCalls(stub).filter((c) => isCall(c, 'label', 'create'));
    const wanted = desiredLabels();
    expect(calls.length, 'one create per manifest label').toBe(wanted.length);
    for (const { name, description, color } of wanted) {
      // Argument-exact: a description is a phrase, so an unquoted expansion in
      // the script would arrive as several arguments and fail here.
      const want = ['label', 'create', name, '--description', description, '--color', color];
      expect(
        calls.some((c) => eqArgv(c, want)),
        `created ${name} with its description and color as single arguments; calls: ${fmtCalls(calls)}`,
      ).toBeTruthy();
    }
    expect(stdout.includes(`created ${wanted.length}`), `reports the count, got: ${stdout}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('labels already matching are left untouched', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels() });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const writes = ghCalls(stub).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    expect(writes.length, `no writes, got: ${fmtCalls(writes)}`).toBe(0);
    expect(stdout.includes(`${desiredLabels().length} already correct`), `reports them correct, got: ${stdout}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('color case difference alone is not drift', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels().map((l) => ({ ...l, color: l.color.toLowerCase() })) });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const writes = ghCalls(stub).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    expect(writes.length, `hex case ignored, got: ${fmtCalls(writes)}`).toBe(0);
    // Zero writes is also what a label step that never ran produces, so say the
    // comparison actually happened.
    expect(
      stdout.includes(`${desiredLabels().length} already correct`),
      `every label was compared, got: ${stdout}`,
    ).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a labels.json in the kit that does not parse: the warning naming it and the fix, and the heal exits 1', () => {
    const kit = mkTmp('wf-std-');
    const engine = path.join(kit, 'workflow');
    fs.cpSync(WORKFLOW_DIR, engine, { recursive: true });
    copyKitSiblings(kit);
    fs.writeFileSync(path.join(engine, 'labels.json'), '{ "groups": ');
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels() });
    const res = heal([repo], {
      ...process.env,
      PATH: joinPath(stub.binDir, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: path.join(mkTmp('wf-std-'), 'workflow-home'),
      WORKFLOW_CLAUDE_HOME: path.join(mkTmp('wf-std-'), 'claude-home'),
    }, { engine: path.join(engine, 'standards.js') });
    const file = gitPath(path.join(fs.realpathSync(kit), 'workflow', 'labels.json'));
    const want = `  ⚠ labels: labels.json at ${file} cannot be read as JSON; reinstall the workflow core`;
    expect((res.stderr || '').split('\n').includes(want), `the warning on stderr, got: ${res.stderr}`).toBe(true);
    expect(res.status, `the heal exits 1 so the caller retries, got: ${res.stdout}${res.stderr}`).toBe(1);
    cleanup(repo); cleanup(stub.dir); cleanup(kit);
  });

  test('description and color drift is corrected, one edit per label', () => {
    const repo = makeRepo();
    const drifted = desiredLabels().map((l, i) => (
      i === 0 ? { ...l, description: 'stale wording' } : i === 1 ? { ...l, color: 'FFFFFF' } : l
    ));
    const stub = makeGhStub({ labels: drifted });
    runScript(repo, { pathPrefix: stub.binDir });
    const edits = ghCalls(stub).filter((c) => isCall(c, 'label', 'edit'));
    expect(edits.length, `exactly the two drifted labels, got: ${fmtCalls(edits)}`).toBe(2);
    const first = desiredLabels()[0];
    const want = ['label', 'edit', first.name, '--description', first.description, '--color', first.color];
    expect(
      edits.some((c) => eqArgv(c, want)),
      `restores the manifest wording as single arguments, got: ${fmtCalls(edits)}`,
    ).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('labels the manifest does not know are never deleted', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [...desiredLabels(), { name: 'area:cli', description: 'repo-local', color: 'CCCCCC' }] });
    runScript(repo, { pathPrefix: stub.binDir });
    const calls = ghCalls(stub);
    // "Never deleted" is vacuously true on an empty log, so prove the label step
    // was reached before proving what it did not do.
    expect(calls.some((c) => isCall(c, 'label', 'list')), `the label step ran, got: ${fmtCalls(calls)}`).toBeTruthy();
    expect(!calls.some((c) => isCall(c, 'label', 'delete')), `no deletions, got: ${fmtCalls(calls)}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a failed label create marks the run unfinished so it retries', () => {
    // A warning alone would exit 0, the hook would cache the day, and the
    // missing label would stay missing until tomorrow.
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [], createFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'a heal that could not finish exits non-zero').toBe(1);
    expect(output.includes('could not create'), `names the failure, got: ${output}`).toBeTruthy();
    expect(output.includes('not fully standardized'), `and reports the repo as unfinished, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a failed label edit marks the run unfinished so it retries', () => {
    const repo = makeRepo();
    const drifted = desiredLabels().map((l, i) => (i === 0 ? { ...l, description: 'stale wording' } : l));
    const stub = makeGhStub({ labels: drifted, editFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit non-zero').toBe(1);
    expect(output.includes('could not update'), `names the failure, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('the label heal makes the status: labels on the public repo and no other group', () => {
    const repo = makeRepo({ settings: '{ "enabled": true, "public": "acme/public" }\n' });
    const stub = makeGhStub({ labels: [] });
    runScript(repo, { pathPrefix: stub.binDir });
    const calls = ghCalls(stub);
    const onPublic = calls.filter((c) => isCall(c, 'label', 'create') && target(c) === 'acme/public').map((c) => c[2]);
    const statuses = desiredLabels().filter((l) => l.name.startsWith('status:')).map((l) => l.name);
    expect(JSON.stringify([...onPublic].sort()), `every status: label and nothing else on acme/public; calls: ${fmtCalls(calls)}`).toBe(JSON.stringify([...statuses].sort()));
    for (const { name, description, color } of desiredLabels().filter((l) => statuses.includes(l.name))) {
      const made = calls.find((c) => isCall(c, 'label', 'create', name) && target(c) === 'acme/public');
      expect(made.includes(description) && made.includes(color), `${name} carries its description and color, got: ${fmtCalls([made])}`).toBeTruthy();
    }
    cleanup(repo); cleanup(stub.dir);
  });

  // The mirror sweep's Node half starts gh by name; written before the stub launcher, it still skips on Windows.
  test('the session-start sweep runs the mirror over the open linked issues, and a failed mirror is a warning, never a failed heal', { skip: skipWithoutNodeStub() }, () => {
    const repo = makeRepo({ settings: '{ "enabled": true, "public": "acme/public" }\n' });
    // The stub answers the public issue's read with no JSON, so the mirror of #12 fails.
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [{
        number: 12, title: 'Split the lists', body: 'Public: https://github.com/acme/public/issues/44\n\nThe fix.', labels: [{ name: 'status:qa' }, { name: 'type:bug' }],
      }],
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    const reads = ghCalls(stub).filter((c) => isCall(c, 'issue', 'view', '44') && target(c) === 'acme/public');
    expect(reads.length, `the sweep read the public issue of #12, calls: ${fmtCalls(ghCalls(stub))}`).toBe(1);
    expect(output.includes('the status of #12 did not reach its public issue'), `the failed mirror is a warning, got: ${output}`).toBeTruthy();
    expect(code, `the heal still exits 0, got: ${output}`).toBe(0);
    cleanup(repo); cleanup(stub.dir);
  });

  test('a public key in the machine settings file pairs a repo whose own file names none', () => {
    const repo = makeRepo({ settings: '{ "enabled": true }\n' });
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, 'settings.json'), '{ "public": "acme/public" }\n');
    const stub = makeGhStub({ labels: [] });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const calls = ghCalls(stub);
    const onPublic = calls.filter((c) => isCall(c, 'label', 'create') && target(c) === 'acme/public').map((c) => c[2]);
    const statuses = desiredLabels().filter((l) => l.name.startsWith('status:')).map((l) => l.name);
    expect(JSON.stringify([...onPublic].sort()), `the status: labels on the machine's acme/public; calls: ${fmtCalls(calls)}`).toBe(JSON.stringify([...statuses].sort()));
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('a public key that is not a slug is a heal warning naming the key, with no public calls', () => {
    const repo = makeRepo({ settings: '{ "enabled": true, "public": "acme public" }\n' });
    const stub = makeGhStub({ labels: desiredLabels() });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(output.includes('public key') && output.includes("'acme public'"), `the warning names the key and its value, got: ${output}`).toBeTruthy();
    const outside = ghCalls(stub).filter((c) => target(c) !== '' || isCall(c, 'issue', 'view'));
    expect(outside.length, `no call reaches a public repo, got: ${fmtCalls(outside)}`).toBe(0);
    cleanup(repo); cleanup(stub.dir);
  });
});

describe('standards.js: the wait line of a gh call', () => {
  // The branch protection step's read of the default branch: the one gh call whose
  // wait line the heal shows, since every other call's output is captured.
  const WAIT = '⏳ reading the default branch...';
  // The heal's own env as runScript builds it, colors off, no quiet or spin setting carried in.
  const healEnv = (stub, extra = {}) => {
    const env = { ...process.env };
    for (const key of ['QUIET', 'WORKKIT_SPIN', 'WORKKIT_COLOR']) delete env[key];
    return seededEnv({
      ...env,
      PATH: joinPath(stub.binDir, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: path.join(mkTmp('wf-std-'), 'workflow-home'),
      WORKFLOW_CLAUDE_HOME: path.join(mkTmp('wf-std-'), 'claude-home'),
      NO_COLOR: '1',
      ...extra,
    });
  };

  test('off a terminal: the default branch\'s wait line is the one wait line on stderr, and no cursor code', () => {
    const piped = runScript(makeRepo(), { pathPrefix: makeGhStub({ labels: desiredLabels() }).binDir, env: { NO_COLOR: '1' } });
    const waits = piped.stderr.split('\n').filter((l) => l.trimStart().startsWith('⏳'));
    expect(waits, `one wait line, the default branch's, at the heal's indent, got: ${JSON.stringify(piped.stderr)}`).toEqual([`  ${WAIT}`]);
    expect(/[\r\x1b]/.test(piped.stderr), `no cursor code, got: ${JSON.stringify(piped.stderr)}`).toBe(false);
  });

  test('at a terminal: the read of the default branch spins, so no wait line, and its line is cleared', { skip: !PTY && 'no `script` here to give the heal a terminal' }, () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels() });
    const tty = atTerminal([process.execPath, SCRIPT, repo], { env: healEnv(stub), cwd: repo, dir: mkTmp('wf-std-') });
    const waits = tty.terminal.split(/\r?\n/).filter((l) => l.trimStart().startsWith('⏳'));
    expect(waits, `no wait line at a terminal, got: ${JSON.stringify(tty.terminal)}`).toEqual([]);
    expect(tty.terminal.includes(CLEAR), `the spinner's line cleared, got: ${JSON.stringify(tty.terminal)}`).toBe(true);
  });

  test('with the frames forced: frames while the default branch is read, then the line cleared', async (t) => {
    const stub = makeGhStub({ labels: desiredLabels() });
    // A gh ahead of the stub that holds the protection step's read of the default branch (the one after its
    // `.full_name` read) until the case has seen a frame; the checks step's read before it passes through.
    const dir = mkTmp('wf-std-');
    const [armed, release, bin] = ['armed', 'release', 'bin'].map((name) => path.join(dir, name));
    fs.mkdirSync(bin);
    t.after(() => fs.writeFileSync(release, ''));
    stubTool(bin, 'gh', [
      '#!/usr/bin/env bash',
      'case "$*" in',
      `  *.full_name*) : > "${shellPath(armed)}" ;;`,
      `  *.default_branch*) if [[ -f "${shellPath(armed)}" ]]; then for ((i = 0; i < 1200; i++)); do [[ -f "${shellPath(release)}" ]] && break; sleep 0.05; done; fi ;;`,
      'esac',
      `exec "${shellPath(path.join(stub.binDir, 'gh'))}" "$@"`,
    ]);
    const heal = start(process.execPath, [SCRIPT, makeRepo()], {
      env: healEnv({ binDir: joinPath(bin, stub.binDir) }, { WORKKIT_SPIN: '1' }),
    });
    const seen = await until(() => framesIn(heal.stderr(), 'reading the default branch').length > 0);
    fs.writeFileSync(release, '');
    const { status } = await heal.done;
    const err = heal.stderr();
    expect(seen, `a frame while the read was held, got: ${JSON.stringify(err)}`).toBe(true);
    const cleared = err.indexOf(CLEAR);
    expect(cleared > err.lastIndexOf('reading the default branch ('), `the clear after the last frame, got: ${JSON.stringify(err)}`).toBe(true);
    expect(err.includes(WAIT), `and no wait line, got: ${JSON.stringify(err)}`).toBe(false);
    expect(status, `the heal ran clean, got: ${heal.output()}`).toBe(0);
  });

  test('under QUIET=1: no wait line, and the labels still read', () => {
    const stub = makeGhStub({ labels: desiredLabels() });
    const res = runScript(makeRepo(), { pathPrefix: stub.binDir, env: { QUIET: '1' } });
    expect(res.code, `the heal runs clean, got: ${res.output}`).toBe(0);
    expect(res.output.includes('⏳'), `no wait line, got: ${res.output}`).toBe(false);
    expect(ghCalls(stub).some((c) => c[0] === 'api' && c.some((a) => a.includes('default_branch'))),
      `the default branch was still asked of GitHub, calls: ${fmtCalls(ghCalls(stub))}`).toBe(true);
  });
});

describe('standards.js: open-issue label report', () => {
  test('issues missing a status label or doubling an exclusive group are named', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [
        { number: 3, labels: [{ name: 'type:bug' }] },
        { number: 4, labels: [{ name: 'status:inbox' }, { name: 'status:specced' }, { name: 'type:bug' }] },
        { number: 5, labels: [{ name: 'status:specced' }, { name: 'type:bug' }, { name: 'priority:high' }, { name: 'priority:low' }] },
        { number: 6, labels: [{ name: 'status:specced' }, { name: 'type:enhancement' }] },
        { number: 7, labels: [{ name: 'status:backlog' }, { name: 'type:idea' }, { name: 'priority:low' }] },
        { number: 8, labels: [{ name: 'status:specced' }] },
        { number: 9, labels: [{ name: 'status:specced' }, { name: 'type:bug' }, { name: 'type:idea' }] },
      ],
    });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'a label violation flags the run: the day is not cached and the heal re-reports next session').toBe(1);
    expect(output.includes('#3'), `an issue without a status is named, got: ${output}`).toBeTruthy();
    expect(output.includes('#4'), `a double status is named, got: ${output}`).toBeTruthy();
    expect(output.includes('#5'), `priority:high plus priority:low is named, got: ${output}`).toBeTruthy();
    expect(!output.includes('#6') && !output.includes('#7'), `a conforming issue is not named: priority absence is normal, got: ${output}`).toBeTruthy();
    expect(output.includes('#8'), `an issue without a type is named: type is required, got: ${output}`).toBeTruthy();
    expect(output.includes('#9'), `a double type is named: type is exclusive, got: ${output}`).toBeTruthy();
    expect(output.includes('workkit:triage'), `names the fix, got: ${output}`).toBeTruthy();
    // The report's own query is the unscoped one: the label-scoped queries
    // belong to the stale-claim sweep.
    const reportQueries = ghCalls(stub)
      .filter((c) => isCall(c, 'issue', 'list') && !c.includes('--label'));
    expect(reportQueries.length, 'one gh call for the whole report').toBe(1);
    cleanup(repo); cleanup(stub.dir);
  });

  test('a conforming issue list stays silent', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [
        { number: 1, labels: [{ name: 'status:specced' }, { name: 'type:bug' }] },
        { number: 2, labels: [{ name: 'status:backlog' }, { name: 'type:idea' }, { name: 'priority:high' }] },
      ],
    });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(!output.includes('workkit:triage'), `nothing to route, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});
