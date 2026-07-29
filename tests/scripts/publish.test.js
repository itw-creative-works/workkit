//
// Tests for workflow/publish.sh — building the tower project and publishing it
// to the home repo's gh-pages branch (issues #27, #77).
//
// The script is run from a COPIED checkout, never this one, and it builds the
// CLONE rather than the checkout: `~/.workkit/tower` is a scratch clone of a
// local bare "GitHub", seeded by hand with the shape a real seed leaves. Its
// build tooling is a stub `omega` binary plus an `npm` shim that writes the
// output a build would leave in apps/web/dist. No omega, no network.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-publish-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const writeStub = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${['#!/usr/bin/env bash', ...lines, ''].join('\n')}`);
  fs.chmodSync(file, 0o755);
};

/**
 * A world: a copied checkout, a scratch HOME and ~/.workkit, a bare "GitHub"
 * with the tower project already on main, and the two shims a publish needs.
 *
 * `tooling: false` leaves the omega binary out of the clone — the machine
 * without the sibling omega checkout, where `npm install` exits 0 and still
 * leaves nothing that can build (probed 2026-07-28).
 * `buildFails` makes the build exit non-zero.
 * `board` is the owner's `site.board` call — the published board snapshot,
 * which is off unless a world says otherwise.
 */
const mkWorld = ({
  tooling = true, buildFails = false, siteUrl = null, home = true, board = false,
} = {}) => {
  const root = mkTmp();
  const kit = path.join(root, 'kit');
  const bin = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  const tower = path.join(workflowHome, 'tower');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });

  // The engine and the libs the snapshot reads, copied so the run's engine is
  // the copy and never this checkout.
  fs.mkdirSync(path.join(kit, 'tower'), { recursive: true });
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'workflow'), kit]);
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'tower', 'api'), path.join(kit, 'tower')]);

  // The build: an `npm --prefix <clone>/apps/web run build` that leaves what a
  // build leaves. Proved against the real app 2026-07-29: `omega build` is the
  // APP's command and it writes dist/ beside src/.
  writeStub(path.join(bin, 'npm'), buildFails
    ? ['printf \'omega: build failed\\n\' >&2', 'exit 1']
    : [
      'prefix=""',
      'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
      'mkdir -p "$prefix/dist/assets"',
      // The output follows the SOURCE, so a test can change what the build
      // ships the way a real change would: by editing the app.
      'cp "$prefix/src/index.html" "$prefix/dist/index.html"',
      'printf \'body{}\\n\' > "$prefix/dist/assets/app.css"',
      'exit 0',
    ]);

  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { encoding: 'utf8' });

  // The site options are the USER'S and live beside the roster (issue #79) —
  // the clone below is engine territory and carries nothing hand-written.
  const settings = {
    version: 1,
    repos: {},
    site: { url: siteUrl, board },
    ...(home ? { home: 'owner/workkit' } : {}),
  };
  fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  const env = {
    HOME: homeDir,
    PATH: `${bin}:${BASE_PATH}:${path.dirname(process.execPath)}`,
    WORKFLOW_HOME: workflowHome,
    WORKKIT_HOME_REMOTE: bare,
  };

  // The clone, carrying what a seed leaves: the project on main — the app and
  // nothing else — and (unless a world says otherwise) the build tooling that
  // proves it can build here.
  if (home) {
    const seed = path.join(root, 'seed');
    fs.mkdirSync(path.join(seed, 'apps', 'web', 'src'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'package.json'), '{ "name": "workkit-tower" }\n');
    fs.writeFileSync(path.join(seed, 'apps', 'web', 'src', 'index.html'), '<html>the board</html>\n');
    fs.writeFileSync(path.join(seed, 'README.md'), '# the tower\n');
    fs.writeFileSync(path.join(seed, '.gitignore'), 'node_modules/\ndist/\n');
    git(seed, 'init', '-q', '-b', 'main');
    git(seed, 'add', '-A');
    git(seed, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore(home): seed the tower project');
    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', '-q', '-u', 'origin', 'main');
    cleanup(seed);

    spawnSync('git', ['clone', '-q', bare, tower], { encoding: 'utf8' });
    if (tooling) writeStub(path.join(tower, 'node_modules', '.bin', 'omega'), ['exit 0']);
  }

  return {
    root,
    kit,
    bare,
    tower,
    workflowHome,
    settings: path.join(workflowHome, 'settings.json'),
    // A tracked file of the project itself, for the cases about what the clone
    // carries rather than what the owner configured.
    source: path.join(tower, 'README.md'),
    dist: path.join(tower, 'apps', 'web', 'dist'),
    env,
  };
};

const publish = (world, args = []) => {
  const res = spawnSync('bash', [path.join(world.kit, 'workflow', 'publish.sh'), ...args], {
    env: world.env, encoding: 'utf8', timeout: 60000,
  });
  assert(res.status !== null, `publish finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const setSite = (world, patch) => {
  const settings = JSON.parse(fs.readFileSync(world.settings, 'utf8'));
  settings.site = { ...settings.site, ...patch };
  fs.writeFileSync(world.settings, `${JSON.stringify(settings, null, 2)}\n`);
};

/** What the published branch actually carries, as a fresh clone sees it. */
const fromPages = (world) => {
  const check = path.join(world.root, `check-${Math.random().toString(36).slice(2)}`);
  const res = spawnSync('git', ['clone', '-q', '-b', 'gh-pages', world.bare, check], { encoding: 'utf8' });
  return res.status === 0 ? check : null;
};

const onMain = (world) => {
  const check = path.join(world.root, `main-${Math.random().toString(36).slice(2)}`);
  spawnSync('git', ['clone', '-q', world.bare, check], { encoding: 'utf8' });
  return check;
};

const run = async () => {
  group('workflow/publish: shape');

  await test('it parses and is executable', () => {
    const script = path.join(REPO_ROOT, 'workflow', 'publish.sh');
    assertEq(spawnSync('bash', ['-n', script], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
    // eslint-disable-next-line no-bitwise
    assert((fs.statSync(script).mode & 0o111) !== 0, 'the executable bit is set');
  });

  group('workflow/publish: the reasons not to');

  await test('no home repo is a named skip, and nothing is built', () => {
    const world = mkWorld({ home: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0 — a machine without a home repo is not broken');
    assert(/no home repo/.test(out), `it names the reason, got: ${out}`);
    assert(!fs.existsSync(world.dist), 'and never runs a build');
    cleanup(world.root);
  });

  await test('a configured home with nothing cloned points at setup', () => {
    const world = mkWorld({ home: false });
    fs.writeFileSync(
      path.join(world.workflowHome, 'settings.json'),
      `${JSON.stringify({ version: 1, repos: {}, home: 'owner/workkit' }, null, 2)}\n`,
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
      `${JSON.stringify({ version: 1, repos: {}, home: 'owner/workkit' }, null, 2)}\n`,
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

    assertEq(fs.readFileSync(world.source, 'utf8'), mine, 'the local edit is back, with no conflict markers in it');
    assertEq(spawnSync('git', ['-C', world.tower, 'stash', 'list'], { encoding: 'utf8' }).stdout.trim(), '',
      'and nothing of it was left behind in a stash');
    cleanup(world.root);
  });

  await test('a settings file that does not parse refuses loudly instead of defaulting', () => {
    // `site.board` and `site.url` decide what is published. An unreadable
    // settings file read as an absent one would turn the board switch off and
    // drop the CNAME without a word — and the same file names the home repo,
    // so the refusal has to come before every other check.
    const world = mkWorld({ board: true });
    publish(world);
    assert(fs.existsSync(path.join(fromPages(world), 'data', 'board.json')), 'the board was published');
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(world.settings, '{ "site": { "board": true, }\n');
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0 — a file to fix is not a crash');
    assert(/does not parse as JSON/.test(out) && /settings\.json/.test(out), `it names the file, got: ${out}`);
    assert(!/no home repo/.test(out), `and never reads an unparseable file as a machine with no home, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'and the published site was not quietly rebuilt without its board');
    cleanup(world.root);
  });

  await test('a build that fails exits non-zero with its last lines', () => {
    const world = mkWorld({ buildFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, 'the caller can tell a failure from a skip');
    assert(/build failed/.test(out + err), `and sees what the build said, got: ${out}${err}`);
    cleanup(world.root);
  });

  group('workflow/publish: the published branch');

  await test('the built dashboard is pushed to gh-pages, at its root', () => {
    const world = mkWorld();
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);

    const pages = fromPages(world);
    assert(pages, 'the branch exists after the first publish');
    assertEq(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), '<html>the board</html>\n', 'the build is at the branch root');
    assert(fs.existsSync(path.join(pages, 'assets', 'app.css')), 'assets and all');
    assert(fs.existsSync(path.join(pages, '.nojekyll')), 'with .nojekyll, so Pages serves it as it is');

    const subject = spawnSync('git', ['-C', pages, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    assert(/^chore\(site\): publish \d{4}-\d{2}-\d{2}$/.test(subject), `one conventional subject, got: ${subject}`);
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
    assert(fs.existsSync(path.join(world.tower, 'apps', 'web', 'src', 'index.html')), 'with its source where it was');
    const worktrees = spawnSync('git', ['-C', world.tower, 'worktree', 'list'], { encoding: 'utf8' }).stdout;
    assertEq(worktrees.trim().split('\n').length, 1, `the temporary worktree is cleaned up: ${worktrees}`);
    cleanup(world.root);
  });

  await test('a second publish updates the branch rather than starting a new one', () => {
    const world = mkWorld();
    publish(world);
    const first = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();

    // Something the build now ships that it did not before.
    fs.writeFileSync(path.join(world.tower, 'apps', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);

    const pages = fromPages(world);
    const log = spawnSync('git', ['-C', pages, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
    assertEq(log.length, 2, `the branch has a history, not a fresh root each time: ${log.join(' | ')}`);
    assert(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim() !== first,
      'and it moved');
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

  group('workflow/publish: the owner’s two switches');

  await test('the board snapshot is baked in beside the pages when the owner says so', () => {
    const world = mkWorld({ board: true });
    publish(world);
    const pages = fromPages(world);
    const snapshot = JSON.parse(fs.readFileSync(path.join(pages, 'data', 'board.json'), 'utf8'));
    assert(typeof snapshot.generatedAt === 'string', 'it is stamped');
    assert(Array.isArray(snapshot.repos), 'it names the roster it swept');
    assert(snapshot.board && typeof snapshot.board.ok === 'boolean', 'and carries the board with its own ok');
    cleanup(world.root);
  });

  await test('the board snapshot is OFF by default — Pages is public', () => {
    // GitHub Pages serves to anyone with the URL even from a private repo, and
    // the snapshot is every issue title across every repo on the roster.
    const world = mkWorld();
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const pages = fromPages(world);
    assert(!fs.existsSync(path.join(pages, 'data', 'board.json')), 'nothing about the board is published');
    assert(fs.existsSync(path.join(pages, 'index.html')), 'and the dashboard itself still publishes');
    cleanup(world.root);
  });

  await test('turning the board off again un-publishes the snapshot', () => {
    const world = mkWorld({ board: true });
    publish(world);
    assert(fs.existsSync(path.join(fromPages(world), 'data', 'board.json')), 'it was published');

    setSite(world, { board: false });
    const { out } = publish(world);
    assert(/was removed/.test(out), `it says what it took away, got: ${out}`);
    assert(!fs.existsSync(path.join(fromPages(world), 'data', 'board.json')), 'and it is gone from what Pages serves');
    cleanup(world.root);
  });

  await test('an untouched board is not a commit a day', () => {
    // The snapshot's stamp changes every run; its substance does not. A publish
    // that would only move the timestamp must leave the branch alone.
    const world = mkWorld({ board: true });
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();
    const { out } = publish(world);
    assert(/already current/.test(out), `the second run has nothing to say, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'and the branch did not move');
    cleanup(world.root);
  });

  await test('a site.url becomes the CNAME, and clearing it removes the file', () => {
    const world = mkWorld({ siteUrl: 'https://board.example.com' });
    publish(world);
    assertEq(fs.readFileSync(path.join(fromPages(world), 'CNAME'), 'utf8'), 'board.example.com\n',
      'the scheme is not part of a CNAME');

    setSite(world, { url: null });
    publish(world);
    assert(!fs.existsSync(path.join(fromPages(world), 'CNAME')), 'clearing it takes the file away');
    cleanup(world.root);
  });

  await test('a settings file with no site key at all publishes the defaults', () => {
    // Nothing pre-creates the key, so an absent one has to read as url null and
    // board false rather than as an error.
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, repos: {}, home: 'owner/workkit' }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const pages = fromPages(world);
    assert(fs.existsSync(path.join(pages, 'index.html')), 'the dashboard publishes');
    assert(!fs.existsSync(path.join(pages, 'data', 'board.json')), 'with no board snapshot');
    assert(!fs.existsSync(path.join(pages, 'CNAME')), 'and no CNAME');
    cleanup(world.root);
  });

  group('workflow/publish: the source side');

  await test('an edit to the project itself is committed and pushed to main', () => {
    const world = mkWorld();
    fs.writeFileSync(world.source, '# the tower, edited\n');
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const main = onMain(world);
    assert(/edited/.test(fs.readFileSync(path.join(main, 'README.md'), 'utf8')),
      'the source change travelled with the publish');
    cleanup(world.root);
  });

  await test('--quiet says nothing when there is nothing to report', () => {
    const world = mkWorld({ home: false });
    const { code, out } = publish(world, ['--quiet']);
    assertEq(code, 0, 'exit 0');
    assertEq(out, '', `the daily job's log stays clean, got: ${out}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
