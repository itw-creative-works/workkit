//
// Tests for jobs/morning.sh as a GITHUB ACTIONS RUNNER runs it: the shape of
// the script, and the cloud steps that run on a runner only.
// The shared prologue (the world factory, the no-jq PATH, the job runner, the two case gates) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const {
  SCRIPT, HOME_SLUG, cleanup, mkWorld, runJob, execBitTest,
} = require('./helpers');

const run = async () => {
  group('jobs/morning (cloud): shape');

  await test('bash -n: no syntax errors', () => {
    const res = spawnSync(BASH, [...NO_RC, '-n', shellPath(SCRIPT)], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await execBitTest('the script is executable', () => {
    // eslint-disable-next-line no-bitwise
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the workflow runs it through bash, but a human runs it directly');
  });

  await test('a runner runs the brief alone: every other step names its skip', () => {
    // The capability gates from the cloud side (issue #107): the summaries read
    // a machine's transcripts and git history, the publish builds the home
    // clone, and a runner has neither. A named skip is what tells that apart
    // from a step that quietly did nothing.
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/summaries: a GitHub Actions runner has no session transcripts/.test(res.stdout),
      `the summaries step names its skip: ${res.stdout}`);
    assert(!fs.existsSync(world.nightlyLog), 'and never started: there is no day here to write up');
    assert(/publish: the site is built from the home clone/.test(res.stdout),
      `the publish names its skip: ${res.stdout}`);
    // Issue #173: the stale-brief marker is read at session start on a MACHINE,
    // and a runner's home dies with the job: there is nobody there to leave it
    // for, and a marker written into that home would be thrown away unread.
    assert(/marker: the brief marker is read at session start on a machine/.test(res.stdout),
      `the marker step names its skip: ${res.stdout}`);
    assert(!fs.existsSync(path.join(world.workflowHome, 'brief-status.json')),
      'and nothing was written into the runner’s home');
    assertEq(world.notifs().length, 0, 'and nothing was notified: there is no desktop');
    cleanup(world.root);
  });

  await test('a runner never reconciles the seeded copy it is running', () => {
    // Issue #143: the machine refreshes the home repo's `brief/` copies from its
    // checkout every morning. On a runner those copies ARE what is executing and
    // there is no checkout to seed them from, so the step is a named skip, and
    // a home clone sitting where the machine's would be is left untouched.
    const world = mkWorld({ settings: { version: 1, site: { repo: HOME_SLUG } } });
    const remote = path.join(world.root, 'remote.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { encoding: 'utf8' });
    const clone = path.join(world.home, '.workkit', 'tower');
    spawnSync('git', ['clone', '-q', remote, clone], { encoding: 'utf8' });
    const seeded = path.join(clone, 'brief', 'jobs', 'morning.sh');
    fs.mkdirSync(path.dirname(seeded), { recursive: true });
    fs.writeFileSync(seeded, '# last month’s runner\n');
    // The engine's own seam: with it the clone IS the home repo's clone, which
    // is what a machine would reconcile.
    world.env.WORKKIT_HOME_REMOTE = remote;

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/runner: a runner IS the seeded copy of the cloud brief/.test(res.stdout),
      `the step names its skip: ${res.stdout}`);
    assertEq(fs.readFileSync(seeded, 'utf8'), '# last month’s runner\n',
      'and nothing was seeded over the scripts this run is made of');
    cleanup(world.root);
  });

  group('jobs/morning (cloud): a runner only');

  await test('off a runner the cloud steps never run, and the machine’s roster is untouched', () => {
    // The synthetic machine REPLACES what is in ~/.workkit: on a laptop that is
    // every registered repo and every recorded decline, swapped for synthetic
    // cloud paths that would then live on the tower forever. GITHUB_ACTIONS is
    // the gate on all of it.
    const world = mkWorld();
    const roster = path.join(world.home, '.workkit', '.repos.json');
    fs.mkdirSync(path.join(world.home, '.workkit'), { recursive: true });
    const before = JSON.stringify({
      version: 1,
      repos: {
        '/Users/someone/Developer/Repositories/Owner/one': 'enabled',
        '/Users/someone/Developer/Repositories/Owner/two': 'declined',
      },
    }, null, 2);
    fs.writeFileSync(roster, before);
    // The machine leg's own steps are that suite's business; here the run is
    // only asked to leave ~/.workkit alone.
    fs.rmSync(path.join(world.home, '.claude'), { recursive: true, force: true });

    const env = { ...world.env };
    delete env.GITHUB_ACTIONS;
    spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], { encoding: 'utf8', timeout: 60000, env });

    assertEq(fs.readFileSync(roster, 'utf8'), before, 'the roster is byte-identical: nothing was registered or dropped');
    assertEq(world.calls().length, 0, 'and nothing was sent: the day is dispatched from a machine, never composed on it');
    assertEq(world.created().length, 0, 'nor published');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
