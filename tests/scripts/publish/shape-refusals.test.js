//
// Tests for workflow/publish.sh: the shape of the script, and the reasons
// not to publish (no home repo, no clone, no tooling, a clone that cannot
// move, a settings file that does not parse, a build that fails).
// The shared prologue (the world factory, the publish runner, the settings and branch readers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skip, summary, selfRun } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath } = require('../../lib/platform');
const { REPO_ROOT, cleanup, git, mkWorld, publish, fromPages, onMain } = require('./helpers');

const run = async () => {
  group('workflow/publish: shape');

  await test('it parses and is executable', () => {
    const script = path.join(REPO_ROOT, 'workflow', 'publish.sh');
    assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(script)], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) skip('publish.sh carries the executable bit', NO_EXEC_BIT);
    else assert((fs.statSync(script).mode & 0o111) !== 0, 'the executable bit is set');
  });

  group('workflow/publish: the reasons not to');

  await test('no home repo is a named skip, and nothing is built', () => {
    const world = mkWorld({ home: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0: a machine without a home repo is not broken');
    assert(/no home repo/.test(out), `it names the reason, got: ${out}`);
    assert(!fs.existsSync(world.dist), 'and never runs a build');
    cleanup(world.root);
  });

  await test('a configured home with nothing cloned points at setup', () => {
    const world = mkWorld({ home: false });
    fs.writeFileSync(
      path.join(world.workflowHome, 'settings.json'),
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/nothing is cloned/.test(out) && /workkit setup/.test(out), `it names the fix, got: ${out}`);
    cleanup(world.root);
  });

  await test('no build tooling is a named skip that says what is missing', () => {
    // The honest signal: `npm install` in the project EXITS 0 on a machine
    // without the sibling omega checkout and leaves dangling symlinks, so the
    // presence of the binary is the only thing worth checking.
    const world = mkWorld({ tooling: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/node_modules\/\.bin\/omega/.test(out), `it names what is missing, got: ${out}`);
    assert(/file: spec/.test(out), 'and why it is missing');
    assertEq(fromPages(world), null, 'nothing is published');
    cleanup(world.root);
  });

  await test('a folder that is not the clone publishes nothing', () => {
    const world = mkWorld({ home: false });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);
    fs.writeFileSync(
      path.join(world.workflowHome, 'settings.json'),
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true } }, null, 2)}\n`,
    );

    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/not the home repo's clone/.test(out), `it says why, got: ${out}`);
    cleanup(world.root);
  });

  await test('a diverged clone is skipped, and nothing is forced onto main', () => {
    const world = mkWorld();
    // Two histories that disagree: someone else pushed while this machine
    // committed something of its own.
    const other = onMain(world);
    fs.writeFileSync(path.join(other, 'README.md'), '# the tower, from elsewhere\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): elsewhere');
    git(other, 'push', '-q');
    fs.writeFileSync(world.source, '# the tower, from here\n');
    git(world.tower, 'add', '-A');
    git(world.tower, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): here');

    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim();
    const { code, out } = publish(world);
    assertEq(code, 0, 'a divergence is a skip, not a failure');
    assert(/could not catch up with its upstream/.test(out) && /nothing was forced/.test(out),
      `it names the symptom and the fix, and calls no offline or auth failure a divergence, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim(), before,
      'and main on the remote is exactly where it was');
    assertEq(fromPages(world), null, 'with nothing published');
    cleanup(world.root);
  });

  await test('an autostash that cannot come back publishes nothing and puts the tree back', () => {
    // The silent half of `pull --rebase --autostash`: the rebase lands, the
    // stash CONFLICTS on its way back, and the pull still exits 0 over a tree
    // full of conflict markers (probed 2026-07-29). A run carrying on from
    // there would push the markers to main.
    const world = mkWorld();
    const other = onMain(world);
    fs.writeFileSync(path.join(other, 'README.md'), '# the tower, theirs\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): their edit');
    git(other, 'push', '-q');
    const mine = '# the tower, mine\n';
    fs.writeFileSync(world.source, mine);

    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim();
    const { code, out } = publish(world);
    assertEq(code, 0, 'a conflict is a skip, not a failure');
    assert(/conflict/.test(out) && /put back/.test(out), `it says what it did, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim(), before,
      'main on the remote is exactly where it was');
    assertEq(fromPages(world), null, 'and nothing was published');

    // The line endings are the machine git's business (Windows checks out
    // CRLF); what this case is about is that the edit came back whole.
    assertEq(fs.readFileSync(world.source, 'utf8').replace(/\r\n/g, '\n'), mine,
      'the local edit is back, with no conflict markers in it');
    assertEq(spawnSync('git', ['-C', world.tower, 'stash', 'list'], { encoding: 'utf8' }).stdout.trim(), '',
      'and nothing of it was left behind in a stash');
    cleanup(world.root);
  });

  await test('a settings file that does not parse refuses loudly instead of defaulting', () => {
    // `site.publish` and `site.url` decide what is published, and the same file
    // names the home repo the slug list points at. An unreadable file read as an
    // absent one would drop the CNAME and the home without a word, so the
    // refusal has to come before every other check.
    const world = mkWorld();
    publish(world);
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'the site was published');
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(world.settings, '{ "site": { "publish": true, }\n');
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0: a file to fix is not a crash');
    assert(/does not parse as JSON/.test(out) && /settings\.json/.test(out), `it names the file, got: ${out}`);
    assert(!/no home repo/.test(out), `and never reads an unparseable file as a machine with no home, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'and the published site was not quietly rebuilt out of a file nobody can read');
    cleanup(world.root);
  });

  await test('a build that fails exits non-zero with its last lines', () => {
    const world = mkWorld({ buildFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, 'the caller can tell a failure from a skip');
    assert(/build failed/.test(out + err), `and sees what the build said, got: ${out}${err}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
