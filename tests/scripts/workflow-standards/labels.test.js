//
// Tests for standards.sh: the label heal and the open-issue label report.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, skip, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { gitPath, crlfJq, joinPath } = require('../../lib/platform');
const { isCall, eqArgv, fmtCalls } = require('../../lib/argv-log');
const {
  desiredLabels, mkTmp, cleanup, rosterOf, makeRepo, makeGhStub, readFile, ghCalls, runScript,
  repoVersion,
} = require('./helpers');

const run = async () => {
  group('standards.sh: labels');

  await test('creates every manifest label with its description and color', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [] });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const calls = ghCalls(stub).filter((c) => isCall(c, 'label', 'create'));
    const wanted = desiredLabels();
    assertEq(calls.length, wanted.length, 'one create per manifest label');
    for (const { name, description, color } of wanted) {
      // Argument-exact: a description is a phrase, so an unquoted expansion in
      // the script would arrive as several arguments and fail here.
      const want = ['label', 'create', name, '--description', description, '--color', color];
      assert(
        calls.some((c) => eqArgv(c, want)),
        `created ${name} with its description and color as single arguments; calls: ${fmtCalls(calls)}`,
      );
    }
    assert(stdout.includes(`created ${wanted.length}`), `reports the count, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('labels already matching are left untouched', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels() });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const writes = ghCalls(stub).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    assertEq(writes.length, 0, `no writes, got: ${fmtCalls(writes)}`);
    assert(stdout.includes(`${desiredLabels().length} already correct`), `reports them correct, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('color case difference alone is not drift', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: desiredLabels().map((l) => ({ ...l, color: l.color.toLowerCase() })) });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const writes = ghCalls(stub).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    assertEq(writes.length, 0, `hex case ignored, got: ${fmtCalls(writes)}`);
    // Zero writes is also what a label step that never ran produces, so say the
    // comparison actually happened (review finding, 2026-07-24).
    assert(
      stdout.includes(`${desiredLabels().length} already correct`),
      `every label was compared, got: ${stdout}`,
    );
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a jq that writes CRLF: no phantom issue warning, no carriage return written', () => {
    // The Windows jq is a native program whose stdout is in text mode, so every
    // line it writes ends `\r\n`. Two reads break on that, and they are what
    // this case reproduces. The open-issue check answers a LONE `\r` where a
    // conforming board answers nothing, so every heal warns that issues are
    // missing a status or type label when none are, and exits 1 saying the repo
    // is not standardized. And the last field of each manifest line, the colour,
    // arrives wearing a `\r`, which is handed to `gh` and on to GitHub, which
    // refuses a colour that is not six hex digits: the label is never created,
    // so the heal never finishes and asks again every session.
    //
    // The no-drift half is a GUARD, not the repro: a bare jq puts the same `\r`
    // on both sides of that compare, so the two still match. It is here so a fix
    // that strips one side and not the other cannot pass.
    const jqDir = mkTmp();
    if (!crlfJq(jqDir)) {
      skip('a jq that writes CRLF: no phantom issue warning, no carriage return written',
        'this machine has no jq to wrap in one that writes CRLF');
      return;
    }

    // The guard: every label GitHub holds already matches the manifest.
    const matched = makeRepo();
    const held = makeGhStub({ labels: desiredLabels() });
    const quiet = runScript(matched, { pathPrefix: joinPath(jqDir, held.binDir) });
    const writes = ghCalls(held).filter((c) => isCall(c, 'label', 'create') || isCall(c, 'label', 'edit'));
    assertEq(writes.length, 0, `nothing drifted, got: ${fmtCalls(writes)}`);
    assert(
      quiet.output.includes(`${desiredLabels().length} already correct`),
      `every label was compared and matched, got: ${quiet.output}`,
    );

    // The repro: a repo with no labels and a board that conforms. The heal
    // finishes silently, and each create carries the manifest's own description
    // and colour byte for byte.
    const empty = makeRepo();
    const home = mkTmp();
    const none = makeGhStub({
      labels: [],
      issues: [{ number: 1, labels: [{ name: 'status:specced' }, { name: 'type:bug' }] }],
    });
    const { code, output } = runScript(empty, {
      pathPrefix: joinPath(jqDir, none.binDir), workflowHome: home,
    });
    assert(!output.includes('missing a required status'), `no phantom issue warning, got: ${output}`);
    assertEq(code, 0, `the heal finished, got: ${output}`);
    const creates = ghCalls(none).filter((c) => isCall(c, 'label', 'create'));
    for (const { name, description, color } of desiredLabels()) {
      const want = ['label', 'create', name, '--description', description, '--color', color];
      assert(
        creates.some((c) => eqArgv(c, want)),
        `created ${name} with nothing left on its arguments; calls: ${fmtCalls(creates)}`,
      );
    }

    // And what the heal WROTE: both files are jq's own output, so a text-mode jq
    // rewrites every line of them with a `\r` on it. One of the two is committed,
    // so its shape would flip with whichever machine healed last.
    const settings = readFile(path.join(empty, W, 'settings.json'));
    assert(settings.includes('"version"'), `the version was stamped, got: ${JSON.stringify(settings)}`);
    assert(!settings.includes('\r'), `and the committed file is LF, got: ${JSON.stringify(settings)}`);
    const roster = readFile(path.join(home, '.repos.json'));
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(empty))], 'enabled', 'the roster recorded the repo');
    assert(!roster.includes('\r'), `and the roster is LF, got: ${JSON.stringify(roster)}`);

    cleanup(matched); cleanup(held.dir); cleanup(empty); cleanup(home); cleanup(none.dir); cleanup(jqDir);
  });

  await test('description and color drift is corrected, one edit per label', () => {
    const repo = makeRepo();
    const drifted = desiredLabels().map((l, i) => (
      i === 0 ? { ...l, description: 'stale wording' } : i === 1 ? { ...l, color: 'FFFFFF' } : l
    ));
    const stub = makeGhStub({ labels: drifted });
    runScript(repo, { pathPrefix: stub.binDir });
    const edits = ghCalls(stub).filter((c) => isCall(c, 'label', 'edit'));
    assertEq(edits.length, 2, `exactly the two drifted labels, got: ${fmtCalls(edits)}`);
    const first = desiredLabels()[0];
    const want = ['label', 'edit', first.name, '--description', first.description, '--color', first.color];
    assert(
      edits.some((c) => eqArgv(c, want)),
      `restores the manifest wording as single arguments, got: ${fmtCalls(edits)}`,
    );
    cleanup(repo); cleanup(stub.dir);
  });

  await test('labels the manifest does not know are never deleted', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [...desiredLabels(), { name: 'area:cli', description: 'repo-local', color: 'CCCCCC' }] });
    runScript(repo, { pathPrefix: stub.binDir });
    const calls = ghCalls(stub);
    // "Never deleted" is vacuously true on an empty log, so prove the label step
    // was reached before proving what it did not do (review finding, 2026-07-24).
    assert(calls.some((c) => isCall(c, 'label', 'list')), `the label step ran, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => isCall(c, 'label', 'delete')), `no deletions, got: ${fmtCalls(calls)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed label create marks the run unfinished so it retries', () => {
    // a warning alone let the run exit 0, the hook cached the day, and the
    // missing label stayed missing until tomorrow.
    const repo = makeRepo();
    const stub = makeGhStub({ labels: [], createFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'a heal that could not finish exits non-zero');
    assert(output.includes('could not create'), `names the failure, got: ${output}`);
    assert(output.includes('not fully standardized'), `and reports the repo as unfinished, got: ${output}`);
    assertEq(repoVersion(repo), 1, 'the version is not stamped, so the heal is asked again');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed label edit marks the run unfinished so it retries', () => {
    const repo = makeRepo();
    const drifted = desiredLabels().map((l, i) => (i === 0 ? { ...l, description: 'stale wording' } : l));
    const stub = makeGhStub({ labels: drifted, editFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'exit non-zero');
    assert(output.includes('could not update'), `names the failure, got: ${output}`);
    assertEq(repoVersion(repo), 1, 'not stamped');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: open-issue label report');

  await test('issues missing a status label or doubling an exclusive group are named', () => {
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
    assertEq(code, 1, 'a label violation flags the run: the day is not cached and the heal re-reports next session');
    assert(output.includes('#3'), `an issue without a status is named, got: ${output}`);
    assert(output.includes('#4'), `a double status is named, got: ${output}`);
    assert(output.includes('#5'), `priority:high plus priority:low is named, got: ${output}`);
    assert(!output.includes('#6') && !output.includes('#7'), `a conforming issue is not named: priority absence is normal, got: ${output}`);
    assert(output.includes('#8'), `an issue without a type is named: type is required, got: ${output}`);
    assert(output.includes('#9'), `a double type is named: type is exclusive, got: ${output}`);
    assert(output.includes('workkit:triage'), `names the fix, got: ${output}`);
    // The report's own query is the unscoped one: the label-scoped queries
    // belong to the stale-claim sweep.
    const reportQueries = ghCalls(stub)
      .filter((c) => isCall(c, 'issue', 'list') && !c.includes('--label'));
    assertEq(reportQueries.length, 1, 'one gh call for the whole report');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a conforming issue list stays silent', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      issues: [
        { number: 1, labels: [{ name: 'status:specced' }, { name: 'type:bug' }] },
        { number: 2, labels: [{ name: 'status:backlog' }, { name: 'type:idea' }, { name: 'priority:high' }] },
      ],
    });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!output.includes('workkit:triage'), `nothing to route, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
