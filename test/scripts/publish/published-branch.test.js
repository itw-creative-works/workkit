// Tests for workflow/publish.sh: the published branch (the built dashboard
// on gh-pages and never on main, updated, regenerated and pruned as the
// build changes). The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, start, until,
} = require('../../lib/harness');
const {
  gitPath, shellPath, BASH, NO_RC, skipWithoutCaughtSignal,
} = require('../../lib/platform');
const { cleanup, git, mkWorld, publish, fromPages, onMain } = require('./helpers');

describe('workflow/publish: the published branch', () => {
  test('the built dashboard is pushed to gh-pages, at its root', () => {
    const world = mkWorld();
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);

    const pages = fromPages(world);
    expect(pages, 'the branch exists after the first publish').toBeTruthy();
    expect(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), 'the build is at the branch root').toBe('<html>the board</html>\n');
    expect(fs.existsSync(path.join(pages, 'assets', 'app.css')), 'assets and all').toBeTruthy();
    expect(fs.existsSync(path.join(pages, '.nojekyll')), 'with .nojekyll, so Pages serves it as it is').toBeTruthy();

    const subject = spawnSync('git', ['-C', pages, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    expect(/^chore\(site\): publish \d{4}-\d{2}-\d{2}$/.test(subject), `one conventional subject, got: ${subject}`).toBeTruthy();

    // The wiring itself, pinned: the daily publish heals the home repo's labels
    // on the way, so deleting publish.js's call of the heal goes red here.
    expect(world.ghCalls().some((argv) => /label list/.test(argv)),
      `the publish healed the home repo's labels: ${world.ghCalls().join(' | ')}`).toBeTruthy();
    cleanup(world.root);
  });

  test('nothing built is ever committed on main', () => {
    // The whole reason for a branch: main stays the project's source, and no
    // folder on it is named for a Pages rule.
    const world = mkWorld();
    publish(world);
    const main = onMain(world);
    const tracked = spawnSync('git', ['-C', main, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n');
    expect(!tracked.includes('index.html'), `no built page at the root of main: ${tracked.join(', ')}`).toBeTruthy();
    expect(!tracked.some((f) => f.startsWith('docs/')), 'and no docs/ folder at all').toBeTruthy();
    expect(!tracked.some((f) => f.includes('/dist/')), 'nor any build output').toBeTruthy();
    expect(tracked.includes('package.json'), 'main carries the project it always did').toBeTruthy();
    expect(!tracked.some((f) => f.startsWith('config/workkit.json')), 'and no site options of its own').toBeTruthy();
    cleanup(world.root);
  });

  test('main’s working tree is untouched by the branch it publishes', () => {
    const world = mkWorld();
    publish(world);
    const branch = spawnSync('git', ['-C', world.tower, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    expect(branch, 'the clone is still on main').toBe('main');
    expect(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'with its source where it was').toBeTruthy();
    const worktrees = spawnSync('git', ['-C', world.tower, 'worktree', 'list'], { encoding: 'utf8' }).stdout;
    expect(worktrees.trim().split('\n').length, `the temporary worktree is cleaned up: ${worktrees}`).toBe(1);
    cleanup(world.root);
  });

  test('a second publish updates the branch rather than starting a new one', () => {
    const world = mkWorld();
    publish(world);
    const first = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();

    // Something the build now ships that it did not before.
    fs.writeFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);

    const pages = fromPages(world);
    const gitLog = spawnSync('git', ['-C', pages, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(gitLog.length, `the branch has a history, not a fresh root each time: ${gitLog.join(' | ')}`).toBe(2);
    expect(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim() !== first,
      'and it moved').toBeTruthy();
    cleanup(world.root);
  });

  test('a deleted remote branch is regenerated fresh despite the stale local one', () => {
    // Regenerating gh-pages (delete the remote, publish again) is the history
    // scrub. The first publish leaves a local gh-pages branch in the clone, and
    // an orphan checkout refuses a name that already exists: the script must
    // drop the stale local branch first.
    const world = mkWorld();
    publish(world);
    spawnSync('git', ['-C', world.bare, 'branch', '-D', 'gh-pages']);

    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const pages = fromPages(world);
    expect(pages, 'the branch is back').toBeTruthy();
    const gitLog = spawnSync('git', ['-C', pages, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(gitLog.length, `one commit, no old history: ${gitLog.join(' | ')}`).toBe(1);
    cleanup(world.root);
  });

  test('a publish ended by SIGTERM mid-push leaves no worktree registered, and the next one publishes', {
    skip: skipWithoutCaughtSignal(),
  }, async (t) => {
    // The remote holds the first gh-pages push, the step that runs inside the
    // temp worktree, until the case writes `go`; that held push is refused.
    const world = mkWorld();
    const held = path.join(world.root, 'held');
    const go = path.join(world.root, 'go');
    const released = path.join(world.root, 'released');
    const hook = path.join(world.bare, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, [
      '#!/bin/sh',
      'while read old new ref; do',
      `  if [ "$ref" = refs/heads/gh-pages ] && [ ! -e ${JSON.stringify(go)} ]; then`,
      `    : > ${JSON.stringify(held)}`,
      `    while [ ! -e ${JSON.stringify(go)} ] && [ -d ${JSON.stringify(world.root)} ]; do sleep 0.1; done`,
      `    : > ${JSON.stringify(released)}`,
      '    exit 1',
      '  fi',
      'done',
      'exit 0',
      '',
    ].join('\n'));
    fs.chmodSync(hook, 0o755);
    t.after(() => { if (fs.existsSync(world.root)) fs.writeFileSync(go, ''); });
    const worktrees = () => spawnSync('git', ['-C', world.tower, 'worktree', 'list'], { encoding: 'utf8' }).stdout.trim().split('\n');

    const call = start(BASH, [...NO_RC, shellPath(path.join(world.kit, 'workflow', 'publish.sh'))], { env: world.env });
    expect(await until(() => fs.existsSync(held)), `the push was reached: ${call.output()}`).toBeTruthy();
    expect(worktrees().length, `the temp worktree is registered while the push runs: ${worktrees().join(' | ')}`).toBe(2);

    // The step in hand ends once the held push is let go (refused); the run
    // must stop there, by the signal, with its cleanup done.
    process.kill(call.pid, 'SIGTERM');
    fs.writeFileSync(go, '');
    const { signal } = await call.done;
    expect(signal, `publish ended by the signal it was sent: ${call.output()}`).toBe('SIGTERM');
    expect(worktrees().length, `and no temp worktree is left registered: ${worktrees().join(' | ')}`).toBe(1);

    expect(await until(() => fs.existsSync(released)), 'the held push was let go').toBeTruthy();
    const { code, out } = publish(world);
    expect(code, `the next publish succeeds: ${out}`).toBe(0);
    expect(fs.readFileSync(path.join(fromPages(world), 'index.html'), 'utf8'), 'and publishes the build').toBe('<html>the board</html>\n');
    cleanup(world.root);
  });

  test('--quiet stays the run\'s own: no program it starts sees QUIET', () => {
    const world = mkWorld();
    const { code, out } = publish(world, ['--quiet']);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(fs.existsSync(path.join(fromPages(world), 'index.html')), 'the quiet run published').toBeTruthy();
    const seen = world.quietSeen();
    expect(seen.length > 0, 'the heal\'s gh and the build\'s npm were started').toBeTruthy();
    expect([...new Set(seen)].join(','), 'and each of them started with no QUIET in its environment').toBe('unset');
    cleanup(world.root);
  });

  test('on Windows every path a line names is the native spelling', {
    skip: process.platform !== 'win32' && 'a path has a second, POSIX spelling only under Git Bash on Windows',
  }, () => {
    const world = mkWorld();
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const lines = out.split(/\r?\n/).filter(Boolean);
    const mounts = lines.filter((line) => /(^|[\s`'"(=])\/[a-zA-Z]\//.test(line));
    expect(mounts.join('\n'), 'no line spells a drive as a Git Bash mount').toBe('');
    const clone = gitPath(world.tower).toLowerCase();
    for (const step of ['installing the tower project', 'minting the brand assets', 'building the dashboard']) {
      const line = lines.find((l) => l.includes(step)) || '';
      expect(line.toLowerCase().includes(clone), `the ${step} line names the clone as ${clone}, got: ${line}`).toBeTruthy();
    }
    cleanup(world.root);
  });

  test('a page the build stopped shipping stops being published', () => {
    const world = mkWorld();
    publish(world);
    // A leftover on the branch, exactly as an older build would have left it.
    const pages = fromPages(world);
    fs.writeFileSync(path.join(pages, 'retired.html'), 'from an older build\n');
    git(pages, 'add', '-A');
    git(pages, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(site): an older build');
    git(pages, 'push', '-q');

    publish(world);
    const after = fromPages(world);
    expect(!fs.existsSync(path.join(after, 'retired.html')), 'the branch mirrors the build').toBeTruthy();
    expect(fs.existsSync(path.join(after, 'index.html')), 'and still carries what the build ships').toBeTruthy();
    cleanup(world.root);
  });
});
