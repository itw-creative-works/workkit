//
// Tests for workflow/publish.sh: the published branch (the built dashboard
// on gh-pages and never on main, updated, regenerated and pruned as the
// build changes).
// The shared prologue (the world factory, the publish runner, the settings and branch readers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, git, mkWorld, publish, fromPages, onMain } = require('./helpers');

const run = async () => {
  group('workflow/publish: the published branch');

  await test('the built dashboard is pushed to gh-pages, at its root', () => {
    const world = mkWorld();
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);

    const pages = fromPages(world);
    assert(pages, 'the branch exists after the first publish');
    assertEq(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), '<html>the board</html>\n', 'the build is at the branch root');
    assert(fs.existsSync(path.join(pages, 'assets', 'app.css')), 'assets and all');
    assert(fs.existsSync(path.join(pages, '.nojekyll')), 'with .nojekyll, so Pages serves it as it is');

    const subject = spawnSync('git', ['-C', pages, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    assert(/^chore\(site\): publish \d{4}-\d{2}-\d{2}$/.test(subject), `one conventional subject, got: ${subject}`);

    // The wiring itself, pinned: the daily publish heals the home repo's labels
    // on the way (issue #123): deleting the wk_home_heal call goes red here.
    assert(world.ghCalls().some((argv) => /label list/.test(argv)),
      `the publish healed the home repo's labels: ${world.ghCalls().join(' | ')}`);
    cleanup(world.root);
  });

  await test('nothing built is ever committed on main', () => {
    // The whole reason for a branch: main stays the project's source, and no
    // folder on it is named for a Pages rule.
    const world = mkWorld();
    publish(world);
    const main = onMain(world);
    const tracked = spawnSync('git', ['-C', main, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n');
    assert(!tracked.includes('index.html'), `no built page at the root of main: ${tracked.join(', ')}`);
    assert(!tracked.some((f) => f.startsWith('docs/')), 'and no docs/ folder at all');
    assert(!tracked.some((f) => f.includes('/dist/')), 'nor any build output');
    assert(tracked.includes('package.json'), 'main carries the project it always did');
    assert(!tracked.some((f) => f.startsWith('config/workkit.json')), 'and no site options of its own');
    cleanup(world.root);
  });

  await test('main’s working tree is untouched by the branch it publishes', () => {
    const world = mkWorld();
    publish(world);
    const branch = spawnSync('git', ['-C', world.tower, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assertEq(branch, 'main', 'the clone is still on main');
    assert(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'with its source where it was');
    const worktrees = spawnSync('git', ['-C', world.tower, 'worktree', 'list'], { encoding: 'utf8' }).stdout;
    assertEq(worktrees.trim().split('\n').length, 1, `the temporary worktree is cleaned up: ${worktrees}`);
    cleanup(world.root);
  });

  await test('a second publish updates the branch rather than starting a new one', () => {
    const world = mkWorld();
    publish(world);
    const first = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();

    // Something the build now ships that it did not before.
    fs.writeFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);

    const pages = fromPages(world);
    const log = spawnSync('git', ['-C', pages, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
    assertEq(log.length, 2, `the branch has a history, not a fresh root each time: ${log.join(' | ')}`);
    assert(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim() !== first,
      'and it moved');
    cleanup(world.root);
  });

  await test('a deleted remote branch is regenerated fresh despite the stale local one', () => {
    // Issue #110: regenerating gh-pages (delete the remote, publish again) is
    // the history scrub. The first publish leaves a LOCAL gh-pages branch in
    // the clone, and an orphan checkout refuses a name that already exists:
    // the script must drop the stale local branch first.
    const world = mkWorld();
    publish(world);
    spawnSync('git', ['-C', world.bare, 'branch', '-D', 'gh-pages']);

    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const pages = fromPages(world);
    assert(pages, 'the branch is back');
    const log = spawnSync('git', ['-C', pages, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
    assertEq(log.length, 1, `one commit, no old history: ${log.join(' | ')}`);
    cleanup(world.root);
  });

  await test('a page the build stopped shipping stops being published', () => {
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
    assert(!fs.existsSync(path.join(after, 'retired.html')), 'the branch mirrors the build');
    assert(fs.existsSync(path.join(after, 'index.html')), 'and still carries what the build ships');
    cleanup(world.root);
  });

  await test('a publish that changed nothing writes no commit', () => {
    const world = mkWorld();
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();

    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/already current/.test(out), `it says so, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'and the branch is unchanged');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
