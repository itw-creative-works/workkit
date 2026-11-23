// Tests for standards.sh: the kit-owned caller at .github/workflows/checks.yml,
// a job calling the kit's reusable ci.yml and, on a push alone, one calling its
// release.yml, rewritten whenever it differs, the
// repo's default branch filled in, a replaced copy's own steps named for
// hooks.ciSetup or hooks.ciPostInstall. The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync, skipWithoutModes } = require('../../lib/platform');
const { describe, test, expect } = require('../../lib/harness');
const { block, inlineValue, listValue, isContent } = require('../../lib/workflow-yaml');
const { OLD_CHECKS, withSteps, withCloneStep } = require('../../lib/checks-template');
const { cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');

const USES = 'itw-creative-works/workkit/.github/workflows/ci.yml@main';
const RELEASE_USES = 'itw-creative-works/workkit/.github/workflows/release.yml@main';
// The heal's advice for a repo's own step it replaced: a run: step, then a uses: step.
const RUN_ADVICE = 'move this step into hooks.ciSetup, or into hooks.ciPostInstall when it needs the installed packages';
const USES_ADVICE = 'a uses: step cannot run in the kit\'s CI; do its work as a command in hooks.ciSetup or hooks.ciPostInstall';

/**
 * A participating repo whose default branch is trunk wherever the heal may ask:
 * GitHub's answer, origin's HEAD and the local HEAD.
 */
const trunkWorld = () => {
  const repo = makeRepo();
  const stub = makeGhStub({ repoRead: true, defaultBranch: 'trunk' });
  for (const args of [['symbolic-ref', 'HEAD', 'refs/heads/trunk'], ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']]) {
    const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    expect(res.status, `git ${args.join(' ')}: ${res.stderr}`).toBe(0);
  }
  const file = path.join(repo, '.github', 'workflows', 'checks.yml');
  const write = (body) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const run = () => runScript(repo, { pathPrefix: stub.binDir });
  const heal = () => run().output;
  const done = () => { cleanup(repo); cleanup(stub.dir); };
  return { repo, file, write, run, heal, read: () => readFile(file), done };
};

/**
 * The body is the caller: the triggers on trunk with no paths-ignore, a job
 * `checks` calling ci.yml@main with the secrets, and a job `release` calling
 * release.yml@main on a push alone with no secrets, its token able to write
 * contents and actions.
 */
const assertCaller = (body, output) => {
  const lines = body.split(/\r?\n/);
  const on = block(lines, 'on', 0);
  expect(on, `a top-level on:, got: ${body}\n${output}`).toBeTruthy();
  expect(block(on, 'pull_request', 2), `on: lists pull_request:, got: ${on.join('\n')}`).toBeTruthy();
  const push = block(on, 'push', 2);
  expect(push, `on: lists push:, got: ${on.join('\n')}`).toBeTruthy();
  const branches = block(push, 'branches', 4);
  expect(branches, `on.push carries branches, got: ${push.join('\n')}`).toBeTruthy();
  expect(listValue(branches).join(','), 'the push runs on the repo\'s default branch').toBe('trunk');
  expect(block(push, 'paths-ignore', 4), 'and every push runs, the release commit\'s included').toBe(null);
  const jobs = block(lines, 'jobs', 0);
  expect(jobs, `a top-level jobs:, got: ${body}`).toBeTruthy();
  const names = jobs.slice(1).filter((l) => isContent(l) && /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ''));
  expect(names.join(','), 'two jobs, checks and release').toBe('checks,release');
  const job = block(jobs, 'checks', 2);
  const uses = block(job, 'uses', 4);
  const secrets = block(job, 'secrets', 4);
  expect(uses && secrets, `the job carries uses: and secrets:, got: ${job.join('\n')}`).toBeTruthy();
  expect(inlineValue(uses), 'it calls the kit\'s ci.yml at main').toBe(USES);
  expect(inlineValue(secrets), 'with the caller\'s secrets').toBe('inherit');
  const release = block(jobs, 'release', 2);
  const gate = block(release, 'if', 4);
  const perms = block(release, 'permissions', 4);
  const releaseUses = block(release, 'uses', 4);
  expect(gate && perms && releaseUses, `the release job carries if:, permissions: and uses:, got: ${release.join('\n')}`).toBeTruthy();
  expect(inlineValue(gate), 'the release job runs on a push alone').toBe("github.event_name == 'push'");
  const granted = perms.slice(1).filter(isContent).map((l) => l.trim()).sort().join(',');
  expect(granted, 'its token writes contents and actions, nothing else').toBe('actions: write,contents: write');
  expect(inlineValue(releaseUses), 'it calls the kit\'s release.yml at main').toBe(RELEASE_USES);
  expect(block(release, 'secrets', 4), 'and hands it no secrets, since it runs on the job\'s token alone').toBe(null);
};

const warnings = (output) => output.split('\n').filter((l) => l.includes(RUN_ADVICE) || l.includes(USES_ADVICE));

describe('standards.sh: the checks.yml caller', () => {
  test('a repo with no checks.yml gets the caller, its push on the repo\'s default branch', () => {
    const w = trunkWorld();
    const output = w.heal();
    assertCaller(w.read(), output);
    w.done();
  });

  test('a copy identical to the old template is replaced by the caller, with no step warning', () => {
    const w = trunkWorld();
    w.write(OLD_CHECKS);
    const output = w.heal();
    assertCaller(w.read(), output);
    expect(warnings(output).length, `no step to move, got: ${warnings(output).join('\n')}`).toBe(0);
    w.done();
  });

  test('a customized copy with extra run: steps is replaced by the caller, one line per step advising ciSetup or ciPostInstall', () => {
    const w = trunkWorld();
    w.write(withSteps(OLD_CHECKS, [
      '      - name: Install Hugo',
      '        run: sudo snap install hugo',
      '      - name: Install ffmpeg',
      '        run: sudo apt-get install -y ffmpeg',
    ]));
    const output = w.heal();
    assertCaller(w.read(), output);
    const got = warnings(output);
    expect(got.length, `one line per extra step, got: ${got.join('\n')}`).toBe(2);
    const line = (step) => `checks.yml: replaced by the kit's caller; ${RUN_ADVICE}: ${step}`;
    expect(got[0].endsWith(line('Install Hugo: sudo snap install hugo')), `the Hugo step, got: ${got[0]}`).toBeTruthy();
    expect(got[1].endsWith(line('Install ffmpeg: sudo apt-get install -y ffmpeg')), `the ffmpeg step, got: ${got[1]}`).toBeTruthy();
    w.done();
  });

  test('a caller that already matches is not written', () => {
    const w = trunkWorld();
    w.heal();
    const once = w.read();
    const past = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(w.file, past, past);
    const output = w.heal();
    expect(w.read(), 'the same bytes').toBe(once);
    expect(fs.statSync(w.file).mtimeMs, `the file was never rewritten, got: ${output}`).toBe(past.getTime());
    expect(warnings(output).length, 'and nothing to move').toBe(0);
    w.done();
  });

  test('a caller that already matches is compared before any temp file: a folder that takes no new file still heals clean', { skip: skipWithoutModes('a read-only folder does not stop a write') }, () => {
    const w = trunkWorld();
    w.heal();
    const once = w.read();
    const folder = path.dirname(w.file);
    fs.chmodSync(folder, 0o555);
    let output;
    try {
      output = w.heal();
    } finally {
      fs.chmodSync(folder, 0o755);
    }
    expect(w.read(), 'the same bytes').toBe(once);
    expect(output.includes('checks: could not'), `nothing was tried, so nothing failed, got: ${output}`).toBe(false);
    expect(fs.readdirSync(folder), 'and no temp file appeared').toEqual(['checks.yml']);
    w.done();
  });

  test('a .github that is a file: the issue forms step says so, the heal goes on, the checks step says it could not write the caller, flags the run and leaves no temp file', () => {
    const w = trunkWorld();
    fs.writeFileSync(path.join(w.repo, '.github'), 'a file\n');
    const res = w.run();
    const lines = res.output.split('\n').map((l) => l.trimEnd());
    const forms = lines.findIndex((l) => l.endsWith('issue forms: could not write .github/ISSUE_TEMPLATE'));
    const checks = lines.findIndex((l) => l.endsWith('checks: could not write .github/workflows/checks.yml'));
    expect(forms, `the issue forms step says it could not write its folder, got: ${res.output}`).not.toBe(-1);
    expect(checks > forms, `then the checks step, later in the same heal, says it could not write the caller, got: ${res.output}`).toBe(true);
    expect(res.code, `the run is flagged, got: ${res.output}`).toBe(1);
    const left = fs.readdirSync(w.repo, { recursive: true }).filter((p) => p.split(path.sep)[0] !== '.git' && p.includes('.tmp'));
    expect(JSON.stringify(left), 'no temp file anywhere in the repo').toBe('[]');
    expect(fs.readFileSync(path.join(w.repo, '.github'), 'utf8'), 'and the file stands as it was').toBe('a file\n');
    w.done();
  });

  test('a hand edit to the caller is overwritten by the next run', () => {
    const w = trunkWorld();
    w.heal();
    const once = w.read();
    const edited = once.replace('ci.yml@main', 'ci.yml@v9');
    expect(edited !== once, `the caller names ci.yml@main to edit, got: ${once}`).toBeTruthy();
    w.write(edited);
    w.heal();
    expect(w.read(), 'the caller as the kit wrote it').toBe(once);
    w.done();
  });
});

describe('standards.sh: every other customization a replaced copy held is named', () => {
  // The old template as a trunk repo held it, its push on its own default branch.
  const ON_TRUNK = OLD_CHECKS.replace('    branches: [main]\n', '    branches: [trunk]\n');
  // ON_TRUNK with `lines` put in after the first line equal to `anchor`.
  const after = (anchor, lines) => {
    const all = ON_TRUNK.split('\n');
    const at = all.indexOf(anchor);
    expect(at >= 0, `the old template carries ${JSON.stringify(anchor)}`).toBeTruthy();
    return [...all.slice(0, at + 1), ...lines, ...all.slice(at + 1)].join('\n');
  };
  // ON_TRUNK with the line equal to `from` swapped for `lines`.
  const swapped = (from, lines) => after(from, lines).replace(`${from}\n`, '');
  const testRun = () => {
    const all = ON_TRUNK.split('\n');
    const from = all.indexOf('      - name: Test');
    const to = all.indexOf('  changelog:');
    return [...all.slice(0, from), '      - name: Test', '        run: npm run test:ci', ...all.slice(to)].join('\n');
  };
  const KINDS = [
    ['a kit step with its own command', testRun(),
      "the kit's own step runs in place of this one: Test: npm run test:ci"],
    ['setup-node reading a version file', swapped('          node-version: lts/*', ['          node-version-file: .nvmrc']),
      "the kit's own step runs in place of this one: actions/setup-node@v5: uses: actions/setup-node@v5 (with: node-version-file=.nvmrc)"],
    ['setup-node on a pinned version', swapped('          node-version: lts/*', ['          node-version: 20']),
      "the kit's own step runs in place of this one: actions/setup-node@v5: uses: actions/setup-node@v5 (with: node-version=20)"],
    ['an extra uses: step, said to be no step the kit\'s CI can run, its inputs said', withSteps(ON_TRUNK, ['      - uses: ruby/setup-ruby@v1', '        with:', "          ruby-version: '3.3'"]),
      `${USES_ADVICE}: ruby/setup-ruby@v1: uses: ruby/setup-ruby@v1 (with: ruby-version=3.3)`],
    ['job env', after('    runs-on: ubuntu-latest', ['    env:', '      CHROME_BIN: /usr/bin/chromium']),
      'this job setting is not kept: test.env: CHROME_BIN=/usr/bin/chromium'],
    ['a job timeout', after('    runs-on: ubuntu-latest', ['    timeout-minutes: 30']),
      'this job setting is not kept: test.timeout-minutes: 30'],
    ['job services', after('    runs-on: ubuntu-latest', ['    services:', '      postgres:', '        image: postgres:16']),
      'this job setting is not kept: test.services: postgres.image=postgres:16'],
    ['a matrix', after('    runs-on: ubuntu-latest', ['    strategy:', '      matrix:', '        node: [20, 22]']),
      'this job setting is not kept: test.strategy: matrix.node=[20, 22]'],
    ['top-level concurrency', after('    paths-ignore: [CHANGELOG.md]', ['', 'concurrency:', '  group: ci', '  cancel-in-progress: true']),
      'this workflow setting is not kept: concurrency: group=ci, cancel-in-progress=true'],
    ['a trigger beyond the template\'s', after('    paths-ignore: [CHANGELOG.md]', ['  workflow_dispatch:']),
      'this trigger is not kept: workflow_dispatch'],
    ['a push filter beyond the template\'s', after('    branches: [trunk]', ['    tags: [v*]']),
      'this trigger filter is not kept: push.tags: [v*]'],
    ['a push on a branch that is not the default', OLD_CHECKS,
      'this trigger filter is not kept: push.branches: [main]'],
    ['a push on the default branch and another, one per line', swapped('    branches: [trunk]', ['    branches:', '      - trunk', '      - release']),
      'this trigger filter is not kept: push.branches: [trunk, release]'],
    ['the retired kit clone step', withCloneStep(ON_TRUNK),
      'the kit no longer clones itself; a repo whose tests need WORKKIT_ENGINE sets it in hooks.ciSetup'],
  ];

  for (const [kind, body, line] of KINDS) {
    test(`${kind}: the caller replaces the copy, and one line names it`, () => {
      const w = trunkWorld();
      w.write(body);
      const output = w.heal();
      assertCaller(w.read(), output);
      const got = output.split('\n').filter((l) => l.includes('checks.yml: replaced by the kit\'s caller; '));
      expect(got.length, `one line, got: ${got.join('\n')}`).toBe(1);
      expect(got[0].endsWith(`checks.yml: replaced by the kit's caller; ${line}`), `the line, got: ${got[0]}`).toBeTruthy();
      w.done();
    });
  }

  test('a push on exactly the default branch, as a flow list or one item, is no customization', () => {
    for (const body of [ON_TRUNK, swapped('    branches: [trunk]', ['    branches:', '      - trunk'])]) {
      const w = trunkWorld();
      w.write(body);
      const output = w.heal();
      assertCaller(w.read(), output);
      expect(!output.includes('checks.yml: replaced by the kit\'s caller; '), `nothing named, got: ${output}`).toBeTruthy();
      w.done();
    }
  });
});

describe('standards.sh: a default branch nothing names', () => {
  test('no answer from GitHub and no origin/HEAD: the copy stays, one warning names the fix, the run is flagged', () => {
    const repo = makeRepo();
    spawnSync('git', ['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'], { cwd: repo });
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, OLD_CHECKS);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(readFile(file), 'the copy as it was').toBe(OLD_CHECKS);
    const said = output.split('\n').filter((l) => l.includes('cannot tell the default branch'));
    expect(said.length, `one warning, got: ${output}`).toBe(1);
    expect(said[0].includes('git remote set-head origin -a'), `it names the fix, got: ${said[0]}`).toBeTruthy();
    expect(output.includes('not fully standardized'), 'the run is flagged').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('no origin remote: no caller and no warning, since there is no CI to call', () => {
    const repo = makeRepo({ remote: false });
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(!fs.existsSync(path.join(repo, '.github', 'workflows', 'checks.yml')), 'no checks.yml').toBeTruthy();
    expect(output.includes('checks: no origin remote'), `a skip, got: ${output}`).toBeTruthy();
    expect(!output.includes('cannot tell the default branch'), 'no warning').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});

describe('standards.sh: the kit\'s own checkout', () => {
  test('the kit\'s own checks.yml is never rewritten to the caller', () => {
    const w = trunkWorld();
    spawnSync('git', ['remote', 'set-url', 'origin', 'https://example.invalid/acme/workkit.git'], { cwd: path.dirname(path.dirname(path.dirname(w.file))) });
    const own = withSteps(OLD_CHECKS, ['      - name: Windows leg', '        run: echo win']);
    w.write(own);
    const output = w.heal();
    expect(w.read(), 'the file as it was').toBe(own);
    expect(output.includes('checks: this is the workkit kit'), `a skip naming why, got: ${output}`).toBeTruthy();
    expect(warnings(output).length, 'and nothing to move').toBe(0);
    w.done();
  });
});
