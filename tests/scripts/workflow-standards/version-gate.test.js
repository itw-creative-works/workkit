//
// Tests for standards.sh: the version gate and the drift report.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { SYSTEM_BASH, NODE_DIR, NO_RC, shellPath, joinPath } = require('../../lib/platform');
const {
  SCRIPT, cleanup, makeRepo, makeGhStub, binDirWithout, runScript, STANDARD_VERSION, repoVersion,
} = require('./helpers');

const run = async () => {
  group('standards.sh: the version gate and the drift report');

  await test('a retired file is reported and never touched', () => {
    // Deleting PROGRESS.md deletes work items nobody migrated. The script says
    // what to run; a human (or the migrate skill) does it. The name has to be
    // the skill that actually does this job: workkit:migrate advertises the
    // drift report as its trigger, so pointing elsewhere means it never fires.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '## Now\n- something nobody migrated\n');
    const { output } = runScript(dir, { pathPrefix: stub.binDir });
    assert(output.includes('PROGRESS.md is retired'), `named, got: ${output}`);
    assert(output.includes('workkit:migrate'), `says what to run, got: ${output}`);
    assert(fs.existsSync(path.join(dir, 'PROGRESS.md')), 'the file is still there');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a retired plans/ directory is reported', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.mkdirSync(path.join(dir, 'plans'));
    const { output } = runScript(dir, { pathPrefix: stub.binDir });
    assert(output.includes('plans/ is retired'), `named, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a CHANGELOG outside the entry format is reported with a count', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- **A big essay entry** that carries no issue link and no separator at all.',
      '- **Another one** just like it.', '',
    ].join('\n'));
    const { output } = runScript(dir, { pathPrefix: joinPath(stub.binDir, NODE_DIR) });
    assert(/CHANGELOG\.md has 2 entries not in the entry format/.test(output), `counted, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a conforming CHANGELOG is not reported', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- (no issue) \u2014 A short entry in the format.', '', // \u2014 is the CHANGELOG entry separator (U+2014)
    ].join('\n'));
    const { output } = runScript(dir, { pathPrefix: joinPath(stub.binDir, NODE_DIR) });
    assert(!output.includes('not in the entry format'), `silent, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a clean heal stamps the version forward', () => {
    const dir = makeRepo();
    const stub = makeGhStub();
    assertEq(repoVersion(dir), 1, 'starts at 1');
    runScript(dir, { pathPrefix: stub.binDir });
    assertEq(repoVersion(dir), STANDARD_VERSION, 'stamped');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('no node with a CHANGELOG present: the version is not stamped, and the run says so', () => {
    // The CHANGELOG check is guarded on `command -v node`; stamping anyway
    // ended the one-time drift report for a file nobody checked.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), [
      '# Changelog', '', '## [1.0.0] - 2020-01-01', '', '### Added',
      '- **A big essay entry** that carries no issue link and no separator at all.', '',
    ].join('\n'));
    const binDir = binDirWithout('node');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(dir)], {
      env: {
        PATH: joinPath(stub.binDir, binDir),
        WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const code = res.status;
    const output = (res.stdout || '') + (res.stderr || '');
    assertEq(code, 0, 'a missing tool is a machine condition, not a failure');
    assertEq(repoVersion(dir), 1, 'not stamped past a check that never ran');
    assert(output.includes('version not stamped'), `says so on stderr, got: ${output}`);
    // Once node is available the check runs and the same repo stamps forward.
    runScript(dir, { pathPrefix: joinPath(stub.binDir, NODE_DIR) });
    assertEq(repoVersion(dir), STANDARD_VERSION, 'stamps once the check could run');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('no jq: the version is not stamped and the run says why, instead of re-reporting silently forever', () => {
    const dir = makeRepo();
    // Every tool but jq: a hand-listed set falls behind the script as it grows
    // and then dies of a missing utility while claiming to prove something
    // about the excluded one.
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(dir)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')) }, encoding: 'utf8', timeout: 20000,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'exit 0');
    assert(out.includes('version not stamped'), `says the stamp was skipped, got: ${out}`);
    assert(out.includes('jq'), `and names the missing tool, got: ${out}`);
    assertEq(repoVersion(dir), 1, 'the version is untouched');
    cleanup(dir); cleanup(binDir);
  });

  await test('a repo already at the current version looks for nothing', () => {
    // The whole point of recording the version: no scan, no output.
    const dir = makeRepo({ settings: `{ "version": ${STANDARD_VERSION}, "enabled": true }\n` });
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '## Now\n- still here\n');
    const { output } = runScript(dir, { pathPrefix: stub.binDir });
    assert(!output.includes('retired'), `no drift scan, got: ${output}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a failed heal leaves the version alone, so the repo is asked again', () => {
    // The directory form hides settings.json and no negation can undo it, so
    // the gitignore heal reports the repo as needing a human.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, '.gitignore'), `${W}/\n`);
    const { code } = runScript(dir, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'partial heal exits non-zero');
    assertEq(repoVersion(dir), 1, 'not stamped');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('--enable on a legacy repo still gets the drift report', () => {
    // The scenario the report exists for: an old repo joining today, carrying
    // a PROGRESS.md the mechanical heals do not touch. Writing the current
    // version into the brand-new settings file would skip it forever.
    const dir = makeRepo({ settings: null });
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '## Now\n- unmigrated\n');
    const { output } = runScript(dir, { pathPrefix: stub.binDir, args: ['--enable'] });
    assert(output.includes('PROGRESS.md is retired'), `reported on the way in, got: ${output}`);
    assertEq(repoVersion(dir), STANDARD_VERSION, 'and stamped forward afterwards');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('the drift report alone does not fail the run', () => {
    // Those findings need a human; exiting non-zero would nag every session.
    const dir = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '- unfiled\n');
    const { code } = runScript(dir, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(repoVersion(dir), STANDARD_VERSION, 'and still stamped');
    cleanup(dir); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
