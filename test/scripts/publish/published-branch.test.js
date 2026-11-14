// Tests for workflow/publish.sh: the published branch (the built dashboard
// on gh-pages and never on main, updated, regenerated and pruned as the
// build changes). The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
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
    // on the way, so deleting the wk_home_heal call goes red here.
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
