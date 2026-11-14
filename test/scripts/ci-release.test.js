// Tests for .github/scripts/ci-release.js, the reusable release.yml's scan: run
// for real at the root of a scratch repo, the push payload (`before`, `after`,
// the default branch) handed over through GITHUB_EVENT_PATH as Actions does, with a fake gh on PATH
// recording every argv and keeping the notes file each create is given.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  NODE_DIR, SYSTEM_PATH, joinPath, shellPath, spawnSync,
} = require('../lib/platform');
const { fmtCalls, isCall } = require('../lib/argv-log');
const { mkRepo, commitGh } = require('../lib/git-repo');

const SCRIPT = path.join(__dirname, '..', '..', '.github', 'scripts', 'ci-release.js');

const CHANGELOG = [
  '# Changelog', '',
  '## [Unreleased]', '',
  '## [1.2.2] - 2026-10-01', '',
  '### Fixed', '',
  '- [#6](https://github.com/o/r/issues/6) - An older thing.', '',
].join('\n');

// The [1.2.3] section's body a release commit adds, and so the notes it gets.
const NOTES = [
  '### Added',
  '',
  '- [#7](https://github.com/o/r/issues/7) - A thing that shipped.',
  '',
  '### Fixed',
  '',
  '- [#8](https://github.com/o/r/issues/8) - A thing that broke.',
].join('\n');

const PAGES = 'name: pages\non:\n  release:\n    types: [published]\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo pages\n';
const NOTIFY = 'name: notify\non:\n  release:\n    types: [published]\njobs:\n  send:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo notify\n';
// A release workflow whose dispatch requires the tag to build, as a vsix release does.
const VSIX = 'name: vsix\non:\n  release:\n    types: [published]\n  workflow_dispatch:\n    inputs:\n      tag:\n        required: true\njobs:\n  vsix:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo vsix\n';
// A `tag:` key outside workflow_dispatch.inputs: a step's `with:` and a dispatch input's property.
const STRAY_TAG = 'name: docs\non:\n  release:\n  workflow_dispatch:\n    inputs:\n      ref:\n        tag: v0\njobs:\n  docs:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: some/action@v1\n        with:\n          tag: v1\n';
const BUILD = 'name: build\non:\n  push:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n';

/** A repo holding CHANGELOG and `files`, committed; `before` is that commit, the push's start. */
const mkWorld = (files = {}) => {
  const g = mkRepo('ci-release-', { 'CHANGELOG.md': CHANGELOG, ...files });
  return { g, before: g.git('rev-parse', 'HEAD').trim() };
};

/** A plain work commit. */
const workCommit = (g, name) => {
  g.write(`${name}.txt`, `${name}\n`);
  g.git('add', '-A');
  g.git('commit', '-q', '-m', `fix: ${name}`);
};

/** Commit `chore(release): <version>` adding its section of `notes` under [Unreleased]; `body` the message body; returns its sha. */
const releaseCommit = (g, version, { notes = NOTES, body = null } = {}) => {
  const text = fs.readFileSync(path.join(g.repo, 'CHANGELOG.md'), 'utf8');
  g.write('CHANGELOG.md', text.replace('## [Unreleased]\n\n', `## [Unreleased]\n\n## [${version}] - 2026-11-01\n\n${notes}\n\n`));
  g.git('add', '-A');
  g.git('commit', '-q', '-m', `chore(release): ${version}`, ...(body === null ? [] : ['-m', body]));
  return g.git('rev-parse', 'HEAD').trim();
};

/**
 * A gh whose every `release create` copies the notes it was handed (a
 * `--notes-file`'s content, or a `--notes` value) to `<dir>/notes-<tag>`.
 */
const releaseGh = (g, opts = {}) => {
  const dir = path.join(g.dir, 'notes');
  fs.mkdirSync(dir, { recursive: true });
  const D = shellPath(dir);
  const onCreate = `prev=''; for a in "$@"; do if [[ "$prev" == --notes-file ]]; then cat "$a" > "${D}/notes-$3"; `
    + `elif [[ "$prev" == --notes ]]; then printf '%s' "$a" > "${D}/notes-$3"; fi; prev=$a; done`;
  const gh = commitGh({ ...opts, onCreate });
  const notes = (tag) => {
    const file = path.join(dir, `notes-${tag}`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return { ...gh, notes };
};

/** The scan at `g`'s root for the push `before`..HEAD, gh being `gh`. */
const scan = (g, gh, before) => {
  const event = path.join(g.dir, 'event.json');
  fs.writeFileSync(event, JSON.stringify({
    before, after: g.git('rev-parse', 'HEAD').trim(), ref: 'refs/heads/main', repository: { default_branch: 'main' },
  }));
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd: g.repo,
    env: {
      ...g.env,
      PATH: joinPath(gh.binDir, NODE_DIR, SYSTEM_PATH),
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: event,
      GITHUB_REF_NAME: 'main',
    },
    input: '',
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `ci-release finished (no timeout, no signal): ${res.error || ''}`).toBeTruthy();
  const out = res.stdout || '';
  const err = res.stderr || '';
  return { code: res.status, all: out + err };
};

const creates = (gh) => gh.calls().filter((c) => isCall(c, 'release', 'create'));

/** The value after `flag` in `call`, undefined when the flag is not there. */
const flagValue = (call, flag) => {
  const at = call.indexOf(flag);
  return at < 0 ? undefined : call[at + 1];
};

describe('ci-release.js: a release commit in the push', () => {
  test('one chore(release): 1.2.3 commit: gh creates v1.2.3 at that commit, the section as notes', () => {
    const { g, before } = mkWorld();
    workCommit(g, 'work');
    const sha = releaseCommit(g, '1.2.3');
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const made = creates(gh);
    expect(made.length, `one create, got: ${fmtCalls(gh.calls())}`).toBe(1);
    expect(made[0][2], `the tag, got: ${fmtCalls(made)}`).toBe('v1.2.3');
    expect(flagValue(made[0], '--target'), `the target is the release commit's full sha, got: ${fmtCalls(made)}`).toBe(sha);
    expect((gh.notes('v1.2.3') || '').trim(), 'the notes are the [1.2.3] section\'s body').toBe(NOTES);
  });

  test('a PR merge whose second parent holds the release commit: the release at the release commit, not the merge', () => {
    const { g, before } = mkWorld();
    g.git('checkout', '-q', '-b', 'claude/thing');
    workCommit(g, 'work');
    const sha = releaseCommit(g, '1.2.3');
    g.git('checkout', '-q', 'main');
    workCommit(g, 'meanwhile');
    g.git('merge', '-q', '--no-ff', '-m', 'fix: work (#12)', 'claude/thing');
    const merge = g.git('rev-parse', 'HEAD').trim();
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const made = creates(gh);
    expect(JSON.stringify(made.map((c) => [c[2], flagValue(c, '--target')])), `one create at the release commit, not the merge ${merge}, got: ${fmtCalls(made)}`).toBe(JSON.stringify([['v1.2.3', sha]]));
  });

  test('an earlier push\'s release commit never released: this push releases it at that commit, once', () => {
    const { g } = mkWorld();
    const sha = releaseCommit(g, '1.2.3');
    const before = g.git('rev-parse', 'HEAD').trim();
    workCommit(g, 'later');
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const made = creates(gh);
    expect(JSON.stringify(made.map((c) => [c[2], flagValue(c, '--target')])), `one create at the earlier release commit, got: ${fmtCalls(made)}`).toBe(JSON.stringify([['v1.2.3', sha]]));
    expect((gh.notes('v1.2.3') || '').trim(), 'the notes are the [1.2.3] section\'s body').toBe(NOTES);
  });

  test('every unreleased release commit the cut would wait for: v1.0.0 released, v1.1.0 not, the push brings 1.2.0; both are created, oldest first', () => {
    const { g } = mkWorld();
    releaseCommit(g, '1.0.0');
    const older = releaseCommit(g, '1.1.0');
    const before = g.git('rev-parse', 'HEAD').trim();
    const sha = releaseCommit(g, '1.2.0');
    const gh = releaseGh(g, { tags: ['v1.0.0'] });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const made = creates(gh);
    expect(JSON.stringify(made.map((c) => [c[2], flagValue(c, '--target')])), `v1.1.0 at its own commit, then v1.2.0, got: ${fmtCalls(made)}`).toBe(JSON.stringify([['v1.1.0', older], ['v1.2.0', sha]]));
  });

  test('a create that fails while another run made the release: it counts as released, exit 0', () => {
    const { g, before } = mkWorld();
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g, { late: { 'v1.2.3': 1 }, createExit: 1 });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(creates(gh).length, `one create tried, got: ${fmtCalls(gh.calls())}`).toBe(1);
    expect(all.includes('v1.2.3 is there now, so it is released'), `the line saying so, got: ${all}`).toBeTruthy();
  });

  test('gh release view failing for a reason other than not found: its line, exit 1, no create', () => {
    const { g, before } = mkWorld();
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g, { fails: true });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 1, got: ${all}`).toBe(1);
    expect(all.split('\n').includes('ci-release: gh release view v1.2.3 failed: gh: To get started with GitHub CLI, please run: gh auth login'),
      `the gh failure line, got: ${all}`).toBeTruthy();
    expect(creates(gh).length, `no create, got: ${fmtCalls(gh.calls())}`).toBe(0);
  });
});

describe('ci-release.js: nothing to make', () => {
  test('a release commit with a `Release: none` trailer: no create, exit 0', () => {
    const { g, before } = mkWorld();
    releaseCommit(g, '1.2.3', { body: 'Release: none' });
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(creates(gh).length, `no create, got: ${fmtCalls(gh.calls())}`).toBe(0);
  });

  test('a release v1.2.3 already there: no create, exit 0', () => {
    const { g, before } = mkWorld();
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g, { tags: ['v1.2.3'] });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(creates(gh).length, `no create, got: ${fmtCalls(gh.calls())}`).toBe(0);
  });

  test('a push with no release commit: no create, exit 0', () => {
    const { g, before } = mkWorld();
    workCommit(g, 'one');
    workCommit(g, 'two');
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(creates(gh).length, `no create, got: ${fmtCalls(gh.calls())}`).toBe(0);
  });
});

describe('ci-release.js: the workflows a published release would have started', () => {
  test('after the create, a release: workflow taking workflow_dispatch is run, one without it named in a warning', () => {
    const { g, before } = mkWorld({
      '.github/workflows/pages.yml': PAGES,
      '.github/workflows/notify.yml': NOTIFY,
      '.github/workflows/build.yml': BUILD,
    });
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const calls = gh.calls();
    const runs = calls.filter((c) => isCall(c, 'workflow', 'run'));
    expect(JSON.stringify(runs.map((c) => c[2])), `pages.yml alone is run, not notify.yml (no dispatch) nor build.yml (not on release), got: ${fmtCalls(calls)}`).toBe(JSON.stringify(['pages.yml']));
    const created = calls.findIndex((c) => isCall(c, 'release', 'create'));
    const ran = calls.findIndex((c) => isCall(c, 'workflow', 'run'));
    expect(created >= 0 && ran > created, `the run comes after the create, got: ${fmtCalls(calls)}`).toBeTruthy();
    expect(all.split('\n').some((l) => l.includes('notify.yml')), `a warning names notify.yml, got: ${all}`).toBeTruthy();
  });

  test('a re-run after the release was made: v1.2.3 already there, its release commit in the push, the dispatch is tried again', () => {
    const { g, before } = mkWorld({ '.github/workflows/pages.yml': PAGES });
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g, { tags: ['v1.2.3'] });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(creates(gh).length, `no create, got: ${fmtCalls(gh.calls())}`).toBe(0);
    const runs = gh.calls().filter((c) => isCall(c, 'workflow', 'run'));
    expect(JSON.stringify(runs.map((c) => c[2])), `pages.yml is run, got: ${fmtCalls(gh.calls())}`).toBe(JSON.stringify(['pages.yml']));
  });

  test('a re-run that makes no release: v1.2.3 already there, its release commit in the push, a tag-input workflow is run with -f tag=v1.2.3', () => {
    const { g, before } = mkWorld({ '.github/workflows/vsix.yml': VSIX });
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g, { tags: ['v1.2.3'] });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(creates(gh).length, `no create, got: ${fmtCalls(gh.calls())}`).toBe(0);
    const runs = gh.calls().filter((c) => isCall(c, 'workflow', 'run'));
    expect(JSON.stringify(runs.map((c) => [c[2], flagValue(c, '-f')])), `vsix.yml with the found release's tag, got: ${fmtCalls(gh.calls())}`).toBe(JSON.stringify([['vsix.yml', 'tag=v1.2.3']]));
  });

  test('a workflow whose dispatch declares a tag input: v1.1.0 and v1.2.0 released, it is run once with -f tag=v1.2.0; one without it gets no -f', () => {
    const { g } = mkWorld({ '.github/workflows/pages.yml': PAGES, '.github/workflows/vsix.yml': VSIX });
    releaseCommit(g, '1.0.0');
    releaseCommit(g, '1.1.0');
    const before = g.git('rev-parse', 'HEAD').trim();
    releaseCommit(g, '1.2.0');
    const gh = releaseGh(g, { tags: ['v1.0.0'] });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const runs = gh.calls().filter((c) => isCall(c, 'workflow', 'run'));
    expect(JSON.stringify(runs.map((c) => [c[2], flagValue(c, '-f')])), `pages.yml with no input, vsix.yml with the newest tag, got: ${fmtCalls(gh.calls())}`).toBe(JSON.stringify([['pages.yml', undefined], ['vsix.yml', 'tag=v1.2.0']]));
  });

  test('a tag: key outside workflow_dispatch.inputs (a step\'s with:, an input\'s property): no -f', () => {
    const { g, before } = mkWorld({ '.github/workflows/docs.yml': STRAY_TAG });
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g);
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const runs = gh.calls().filter((c) => isCall(c, 'workflow', 'run'));
    expect(JSON.stringify(runs.map((c) => [c[2], flagValue(c, '-f')])), `docs.yml is run with no input, got: ${fmtCalls(gh.calls())}`).toBe(JSON.stringify([['docs.yml', undefined]]));
  });

  test('a failed dispatch: the next workflow is still run, a line names the failure, exit 1', () => {
    const { g, before } = mkWorld({ '.github/workflows/docs.yml': PAGES, '.github/workflows/pages.yml': PAGES });
    releaseCommit(g, '1.2.3');
    const gh = releaseGh(g, { dispatchFails: ['docs.yml'] });
    const { code, all } = scan(g, gh, before);
    expect(code, `exit 1, got: ${all}`).toBe(1);
    const runs = gh.calls().filter((c) => isCall(c, 'workflow', 'run'));
    expect(JSON.stringify(runs.map((c) => c[2])), `docs.yml is tried, then pages.yml still runs, got: ${fmtCalls(gh.calls())}`).toBe(JSON.stringify(['docs.yml', 'pages.yml']));
    expect(all.split('\n').includes('ci-release: dispatch of .github/workflows/docs.yml failed: '
      + 'could not create workflow dispatch event: HTTP 403: Resource not accessible by integration'), `the failure line, got: ${all}`).toBeTruthy();
  });
});
