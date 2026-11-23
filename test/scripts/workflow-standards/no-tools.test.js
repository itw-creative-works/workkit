// Tests for standards.sh: a full heal on a machine with no jq, perl, awk or sed,
// none of which the heal needs. The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect, WORKKIT_DIR: W, mkTmp } = require('../../lib/harness');
const {
  toolStem, which, joinPath, nodeEnv, gitPath,
} = require('../../lib/platform');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const { withSteps, OLD_CHECKS } = require('../../lib/checks-template');
const {
  IGNORE_GLOB, desiredLabels, cleanup, rosterOf, makeRepo, makeGhStub, readFile, ghCalls, binDirWithout,
  runScript,
} = require('./helpers');

const LEFT_OUT = ['jq', 'perl', 'awk', 'sed'];
// Every spelling a machine keeps one of them under (perl5.34, gawk), and gh, so
// only the stand-in answers.
const DROPPED = /^(jq|perl[\d.]*|[gmn]?awk|g?sed|gh)$/;

/** The machine's own tools, git, node and bash among them, less the four and gh. */
const toolsWithoutThem = () => {
  const mirror = binDirWithout('jq');
  for (const name of fs.readdirSync(mirror)) {
    if (DROPPED.test(toolStem(name))) fs.rmSync(path.join(mirror, name), { force: true });
  }
  const left = [...LEFT_OUT, 'gh'].filter((tool) => which(tool, mirror));
  if (left.length) throw new Error(`the mirror still holds ${left.join(', ')}`);
  return mirror;
};

const CLAIM = 'agent:claimed';
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const CALLER_USES = 'itw-creative-works/workkit/.github/workflows/ci.yml@main';

describe('standards.sh: a heal with no jq, perl, awk or sed', () => {
  test('every step runs: the roster, the labels, the stale claim, the caller and the local files', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    // One manifest label missing, never the claim, so the sync has one to make.
    const [missing, ...present] = desiredLabels().sort((a, b) => (a.name === CLAIM) - (b.name === CLAIM));
    const stub = makeGhStub({
      labels: present,
      labeled: { [CLAIM]: [{ number: 8, updatedAt: hoursAgo(30), assignees: [{ login: 'someone' }] }] },
    });
    const checks = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(checks), { recursive: true });
    fs.writeFileSync(checks, withSteps(OLD_CHECKS, ['      - name: Install Hugo', '        run: sudo snap install hugo']));
    const mirror = toolsWithoutThem();

    const { code, output } = runScript(repo, {
      workflowHome: home,
      env: { PATH: joinPath(stub.binDir, mirror), ...nodeEnv },
    });
    // The customised copy's own step is named for a person to move, which flags the run.
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(output.includes('checks.yml: replaced by the kit\'s caller; '), `the replaced step is named, got: ${output}`).toBeTruthy();

    expect(rosterOf(home)[gitPath(fs.realpathSync(repo))], `the roster holds the repo, got: ${output}`).toBe('enabled');
    const creates = ghCalls(stub).filter((c) => isCall(c, 'label', 'create'));
    expect(creates.map((c) => c[2]).join(','), `the labels are synced, got: ${fmtCalls(ghCalls(stub))}`).toBe(missing.name);
    const releases = ghCalls(stub).filter((c) => isCall(c, 'issue', 'edit') && c[2] === '8' && c.includes(CLAIM));
    expect(releases.length, `the stale claim is released, got: ${fmtCalls(ghCalls(stub))}`).toBe(1);

    expect(readFile(checks).includes(CALLER_USES), `the copy is replaced by the caller with no awk, got: ${readFile(checks)}`).toBeTruthy();
    expect(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), `the ignore lines, got: ${output}`).toBeTruthy();
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the issue forms').toBeTruthy();
    expect(fs.existsSync(path.join(repo, W, 'capture.md')), 'and the working files').toBeTruthy();
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(mirror);
  });
});
