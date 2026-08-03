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
 * `roster` is a list of repo folder names to register on this machine's roster,
 * each a real git repo with a committed opt-in — what the published slug list
 * is composed from.
 * `publish` is the owner's `site.publish` call, the all-or-nothing switch: the
 * ordinary world here has said yes, since every case below is about what a
 * publish DOES. The switch itself has its own tests.
 * `pages` is what the GitHub side answers when the teardown disables Pages
 * (issue #113): `configured` is a delete that lands, `none` the 404 of a repo
 * that never had it on.
 * `branch` is the home repo's default branch — the one the clone is on and the
 * one the roster is pushed to. Not every account's is `main` (issue #112).
 */
const mkWorld = ({
  tooling = true, buildFails = false, siteUrl = null, home = true, roster = [],
  publish: publishOn = true, pages = 'configured', branch = 'main',
} = {}) => {
  const root = mkTmp();
  const kit = path.join(root, 'kit');
  const bin = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  const tower = path.join(workflowHome, 'tower');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });

  // The engine and the libs the slug list reads, copied so the run's engine is
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

  // The only thing this script asks `gh` for: disabling Pages when the site is
  // taken down (issue #113). It records its argv, so a test can prove the call
  // was made — and answers a 404 the way gh does for a repo with no Pages,
  // which the teardown has to read as "already off" rather than as a failure.
  const ghLog = path.join(root, 'gh-argv.log');
  writeStub(path.join(bin, 'gh'), [
    `printf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}`,
    ...(pages === 'none'
      ? ['printf \'gh: Not Found (HTTP 404)\\n\' >&2', 'exit 1']
      : ['exit 0']),
  ]);

  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', branch, bare], { encoding: 'utf8' });

  // The site options are the USER'S and live beside the roster (issue #79) —
  // the clone below is engine territory and carries nothing hand-written.
  const settings = {
    version: 1,
    site: { repo: home ? 'owner/workkit' : null, publish: publishOn, url: siteUrl },
  };
  fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  // The roster this machine has registered — the engine's own index, read by
  // the same module the tower and the brief read it with. Each entry is a real
  // repo: a committed opt-in, and an origin the slug is derived from.
  if (roster.length) {
    const registered = {};
    for (const name of roster) {
      const dir = path.join(root, 'repos', name);
      fs.mkdirSync(path.join(dir, '.workkit'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
      git(dir, 'init', '-q', '-b', 'main');
      git(dir, 'remote', 'add', 'origin', `https://github.com/owner/${name}.git`);
      registered[dir] = { registered: '2026-07-29' };
    }
    fs.writeFileSync(path.join(workflowHome, '.repos.json'), `${JSON.stringify({ version: 1, repos: registered }, null, 2)}\n`);
  }

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
    git(seed, 'init', '-q', '-b', branch);
    git(seed, 'add', '-A');
    git(seed, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore(home): seed the tower project');
    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', '-q', '-u', 'origin', branch);
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
    ghCalls: () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean) : []),
    dist: path.join(tower, 'apps', 'web', 'dist'),
    env,
  };
};

/**
 * A bin directory mirroring the real PATH with one tool left out — the suite's
 * idiom for a machine that is missing it. The whole PATH is mirrored rather
 * than a hand-listed set, so the run never dies of some other utility while
 * claiming to prove something about the excluded one.
 */
const binDirWithout = (excluded) => {
  const binDir = mkTmp();
  const seen = new Set();
  for (const dir of ['/usr/bin', '/bin', '/usr/sbin', '/sbin', path.dirname(process.execPath)]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name === excluded || seen.has(name)) continue;
      seen.add(name);
      try {
        fs.symlinkSync(path.join(dir, name), path.join(binDir, name));
      } catch {
        // A name that cannot be linked is simply absent, which is the state the
        // caller is testing for anyway.
      }
    }
  }
  return binDir;
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

    assertEq(fs.readFileSync(world.source, 'utf8'), mine, 'the local edit is back, with no conflict markers in it');
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
    assertEq(code, 0, 'exit 0 — a file to fix is not a crash');
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

    // The wiring itself, pinned: the daily publish heals the home repo's labels
    // on the way (issue #123) — deleting the wk_home_heal call goes red here.
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

  await test('a deleted remote branch is regenerated fresh despite the stale local one', () => {
    // Issue #110: regenerating gh-pages (delete the remote, publish again) is
    // the history scrub. The first publish leaves a LOCAL gh-pages branch in
    // the clone, and an orphan checkout refuses a name that already exists —
    // the script must drop the stale local branch first.
    const world = mkWorld();
    publish(world);
    spawnSync('git', ['-C', world.bare, 'branch', '-D', 'gh-pages']);

    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
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

  group('workflow/publish: the owner’s switches');

  await test('the slug list is written to the home repo’s default branch — names, and nothing else', () => {
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assertEq(list.repos.slice(0, 2).join(','), 'owner/omega,owner/workkit', 'every registered repo, as a slug');
    assert(list.repos.includes('owner/workkit'), 'and the home repo rides along — its issues are the cross-project queue');
    assertEq(list.home, 'owner/workkit', 'named again, because the summaries are Discussions on that one repo');
    assertEq(Object.keys(list).sort().join(','), 'home,repos', 'and the file says nothing else at all');
    cleanup(world.root);
  });

  await test('the roster never reaches the published branch — Pages is public, and the names are not', () => {
    // Issue #110: gh-pages is served to anyone with the URL even when the repo
    // is private, so a file naming every private repo on this machine cannot be
    // beside the pages. It lives on main, where the repo's own privacy covers
    // it, and every reader fetches it with a token.
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const pages = fromPages(world);
    assert(!fs.existsSync(path.join(pages, 'data', 'repos.json')), 'no roster on the published branch');
    const published = spawnSync('git', ['-C', pages, 'ls-files'], { encoding: 'utf8' }).stdout;
    assert(!/omega/.test(published), `and no private repo is named anywhere in what it carries: ${published}`);
    cleanup(world.root);
  });

  await test('nothing but the home repo is published — no roster, no issue data', () => {
    // The whole doctrine of issue #81: Pages is public even from a private repo,
    // and the published copy reads GitHub live with the viewer's own token. A
    // baked board would be every issue title of every repo, served to anyone
    // with the URL.
    const world = mkWorld({ roster: ['workkit'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const pages = fromPages(world);
    assertEq(fs.readdirSync(path.join(pages, 'data')).join(','), 'home.json', 'the data folder holds the home pointer and nothing else');
    assert(!fs.existsSync(path.join(pages, 'data', 'board.json')), 'no board snapshot');
    const pointer = fs.readFileSync(path.join(pages, 'data', 'home.json'), 'utf8');
    assertEq(JSON.parse(pointer).home, 'owner/workkit', 'the repo the site is served from — which its own URL already names');
    assertEq(Object.keys(JSON.parse(pointer)).join(','), 'home,branch',
      'and those two keys — the repo, and the branch of it the private roster is on (issue #112)');
    assert(!/title|body|labels|issues/.test(pointer), `nothing issue-shaped in the one file there is, got: ${pointer}`);
    cleanup(world.root);
  });

  await test('a machine with no roster writes a list with the home repo in it', () => {
    // A machine that has enabled nothing still has a home repo, and its issues
    // are the cross-project queue — so the site is useful from the first
    // publish rather than pointing at nothing.
    const world = mkWorld();
    publish(world);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assertEq(list.repos.join(','), 'owner/workkit', 'the home slug, and only it');
    cleanup(world.root);
  });

  await test('an unchanged roster is not a commit a day', () => {
    // The list carries no stamp of any kind, so a second publish writes the same
    // bytes and neither branch has anything to move for.
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();
    const beforeMain = spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim();
    const { out } = publish(world);
    assert(/already current/.test(out), `the second run has nothing to say, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'and the branch did not move');
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim(), beforeMain,
      'nor did the one the roster is on');
    cleanup(world.root);
  });

  await test('a repo joining the roster reaches the list on the next publish', () => {
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    assertEq(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.length, 1,
      'one to start with');

    const joined = path.join(world.root, 'repos', 'dotfiles');
    fs.mkdirSync(path.join(joined, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(joined, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
    git(joined, 'init', '-q', '-b', 'main');
    git(joined, 'remote', 'add', 'origin', 'https://github.com/owner/dotfiles.git');
    const index = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    index.repos[joined] = { registered: '2026-07-29' };
    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), `${JSON.stringify(index, null, 2)}\n`);

    publish(world);
    assert(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.includes('owner/dotfiles'),
      'the new repo is on the list the board sweeps');
    cleanup(world.root);
  });

  await test('a roster that will not read keeps the list already published, and the run goes on', () => {
    // Issue #116: a compose that FAILS is not a machine with no repos on it.
    // The list stays exactly as the last good run left it — the readers believe
    // this file — and the warn does not cost the run its exit code, because a
    // stale-but-good roster is the designed outcome.
    const world = mkWorld({ roster: ['workkit', 'omega'] });
    publish(world);
    const before = fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8');
    assert(/owner\/omega/.test(before), 'the good list is published first');

    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), '{ not json');
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — a stale roster is not a failed run: ${out}`);
    assert(/repo list could not be composed/.test(out), `and the run says so, got: ${out}`);
    assertEq(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'), before,
      'the list on the default branch is byte for byte what it was');
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'and the site published anyway');
    cleanup(world.root);
  });

  await test('no node — the site publishes and the skip says what it will be missing', () => {
    const world = mkWorld();
    const { code, out } = publish({
      ...world,
      // The build shim stays on the PATH — the case is a machine without node,
      // not a machine that cannot build.
      env: { ...world.env, PATH: `${path.join(world.root, 'bin')}:${binDirWithout('node')}` },
    });
    assertEq(code, 0, 'exit 0 — a missing tool is not a crash');
    assert(/node is not on this machine/.test(out), `it names the tool, got: ${out}`);
    assert(/no repos to sweep/.test(out), `and what will be missing, got: ${out}`);
    // Issue #111: the list feeds the cloud brief as well as the pages, so a skip
    // that names only one reader understates by half what is now stale.
    assert(/dashboard/.test(out) && /cloud brief/.test(out), `and both readers of it, got: ${out}`);
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'and the pages still publish');
    cleanup(world.root);
  });

  await test('the roster is refreshed with the switch off — the cloud brief reads it too', () => {
    // Issue #111: `data/repos.json` on the home repo's default branch is the
    // cloud brief's roster as well as the dashboard's, and the two do not share
    // a fate. A machine that publishes no site still owes the brief a current
    // list, so the compose sits above the switch and above every build check.
    const world = mkWorld({ publish: false, roster: ['workkit', 'omega'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assert(list.repos.includes('owner/omega'), `the list is on the default branch anyway: ${JSON.stringify(list)}`);
    assertEq(fromPages(world), null, 'and nothing at all was pushed to gh-pages');
    assertEq(fs.existsSync(world.dist), false, 'nor built');
    cleanup(world.root);
  });

  await test('no build tooling still refreshes the roster', () => {
    // The other half of the decoupling: the compose needs node, git and the
    // clone, and nothing the build needs.
    const world = mkWorld({ tooling: false, roster: ['workkit', 'omega'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const list = JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8'));
    assert(list.repos.includes('owner/omega'), `composed without a builder: ${JSON.stringify(list)}`);
    assertEq(fromPages(world), null, 'and still nothing published');
    cleanup(world.root);
  });

  await test('the home pointer names the branch the roster is on, not an assumed main', () => {
    // Issue #112: the writer pushes whatever branch the clone is on, so the
    // readers are TOLD which one rather than hardcoding it — a home repo whose
    // default branch is not main 404s on every roster read otherwise.
    const world = mkWorld({ branch: 'trunk', roster: ['workkit'] });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const pointer = JSON.parse(fs.readFileSync(path.join(fromPages(world), 'data', 'home.json'), 'utf8'));
    assertEq(pointer.branch, 'trunk', 'the branch the clone is on');
    assertEq(pointer.home, 'owner/workkit', 'beside the repo it is a branch of');
    assert(fs.existsSync(path.join(onMain(world), 'data', 'repos.json')),
      'and that is where the roster actually landed');
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

  await test('a site key carrying nothing but the switch publishes the defaults', () => {
    // Nothing pre-creates the sub-keys, so an absent `url` has to read as no
    // CNAME rather than as an error.
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    const pages = fromPages(world);
    assert(fs.existsSync(path.join(pages, 'index.html')), 'the dashboard publishes');
    assert(fs.existsSync(path.join(pages, 'data', 'home.json')), 'with its home pointer');
    assert(fs.existsSync(path.join(onMain(world), 'data', 'repos.json')), 'and its roster on main');
    assert(!fs.existsSync(path.join(pages, 'CNAME')), 'and no CNAME');
    cleanup(world.root);
  });

  await test('`site.publish` off publishes NOTHING — not even a build', () => {
    // The all-or-nothing switch (issue #80), and it is default off: what Pages
    // serves is public even from a private repo, so publishing at all is the
    // owner's yes to give. The gate is before the build, so an off machine does
    // no work either.
    const world = mkWorld({ publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'a machine that publishes nothing is not broken');
    assert(/`site.publish` is off/.test(out), `it names the switch, got: ${out}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was even built');
    const branches = spawnSync('git', ['-C', world.bare, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout;
    assertEq(branches.trim(), '', 'and no branch was pushed');
    cleanup(world.root);
  });

  await test('an unanswered switch reads as off — null is nobody having said yes', () => {
    // What the seed now writes (issue #84): null means the question has not
    // been put, and a machine waiting on an answer publishes nothing.
    const world = mkWorld({ publish: null });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0 — unanswered is not broken');
    assert(/`site.publish` is off/.test(out), `null is the off answer, got: ${out}`);
    assertEq(fs.existsSync(world.dist), false, 'and nothing was built');
    cleanup(world.root);
  });

  await test('an absent switch reads as off — the default is not to publish', () => {
    const world = mkWorld();
    fs.writeFileSync(
      world.settings,
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit' } }, null, 2)}\n`,
    );
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/`site.publish` is off/.test(out), `the absent key is the off answer, got: ${out}`);
    cleanup(world.root);
  });

  await test('no jq — the skip names jq, not a switch that is already on', () => {
    // The switch is read through jq, so a machine without it reads empty, which
    // is indistinguishable from off. Blaming the switch would send an owner who
    // already said yes to turn on what is already on.
    const world = mkWorld();
    const { code, out } = publish({
      ...world,
      env: { ...world.env, PATH: binDirWithout('jq') },
    });
    assertEq(code, 0, 'exit 0 — a missing tool is not a crash');
    assert(/jq/.test(out), `it names the missing tool, got: ${out}`);
    assert(!/is off/.test(out), `and never calls an unreadable switch an off one, got: ${out}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was built');
    cleanup(world.root);
  });

  await test('turning the switch off takes the published site down', () => {
    // Issue #113: off governs the site's EXISTENCE, not only its updates — a
    // site left serving forever made the all-or-nothing switch a half-truth. The
    // branch is generated content, so the next yes rebuilds it from scratch.
    const world = mkWorld({ roster: ['workkit'] });
    publish(world);
    assert(fs.existsSync(path.join(fromPages(world), 'index.html')), 'it published');

    // A repo that joined between the two runs — the roster refresh rides the
    // teardown run untouched (issue #111).
    const joined = path.join(world.root, 'repos', 'dotfiles');
    fs.mkdirSync(path.join(joined, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(joined, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
    git(joined, 'init', '-q', '-b', 'main');
    git(joined, 'remote', 'add', 'origin', 'https://github.com/owner/dotfiles.git');
    const index = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    index.repos[joined] = { registered: '2026-07-31' };
    fs.writeFileSync(path.join(world.workflowHome, '.repos.json'), `${JSON.stringify(index, null, 2)}\n`);

    setSite(world, { publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    assertEq(fromPages(world), null, 'the branch Pages served is gone from the remote');
    assert(/taken down/.test(out) && /gh-pages/.test(out), `and the run says what it removed, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.tower, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), '',
      'the stale local copy of it goes too');
    assert(world.ghCalls().some((argv) => /-X DELETE repos\/owner\/workkit\/pages/.test(argv)),
      `Pages itself is disabled, not just left with nothing to serve: ${world.ghCalls().join(' | ')}`);
    assert(/Pages is disabled/.test(out), `and that is said too, got: ${out}`);
    assert(JSON.parse(fs.readFileSync(path.join(onMain(world), 'data', 'repos.json'), 'utf8')).repos.includes('owner/dotfiles'),
      'while the roster refreshed as it always does');
    cleanup(world.root);
  });

  await test('a machine that never published hears nothing about a teardown', () => {
    const world = mkWorld({ publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(!/taken down/.test(out) && !/Pages is disabled/.test(out) && !/nothing to disable/.test(out),
      `nothing was removed, so nothing is reported, got: ${out}`);
    // Scoped to Pages: the run above the switch heals the home repo's labels
    // (issue #123), so gh is spoken to on every publish — never about Pages.
    assert(!world.ghCalls().some((argv) => /pages/.test(argv)),
      `and GitHub is never asked to disable Pages nobody enabled: ${world.ghCalls().join(' | ')}`);
    cleanup(world.root);
  });

  await test('Pages that was never configured is a 404 the teardown reads as already off', () => {
    const world = mkWorld({ pages: 'none' });
    publish(world);
    setSite(world, { publish: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'a 404 is the answer "already off", not a failure');
    assert(/nothing to disable/.test(out), `it says so, got: ${out}`);
    assertEq(fromPages(world), null, 'and the branch came down all the same');
    cleanup(world.root);
  });

  await test('a remote that cannot be reached is never read as a site that is not there', () => {
    // Issue #111: `ls-remote` answers 2 for "no such branch" and 128 for a
    // remote it could not reach, and reading the second as the first dropped the
    // local branch and then failed at the push. The pull is pointed at a
    // reachable copy of the remote so that the probe — and only the probe — is
    // the thing that cannot connect.
    const world = mkWorld();
    publish(world);
    const before = spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim();
    const gone = path.join(world.root, 'gone.git');
    git(world.tower, 'remote', 'add', 'live', world.bare);
    git(world.tower, 'fetch', '-q', 'live');
    git(world.tower, 'branch', '--set-upstream-to=live/main', 'main');
    git(world.tower, 'remote', 'set-url', 'origin', gone);

    // The clone is still the home repo's — origin is the address the settings
    // name, and it is that address that has stopped answering.
    const { code, out } = publish({ ...world, env: { ...world.env, WORKKIT_HOME_REMOTE: gone } });
    assertEq(code, 0, `an unreachable remote is a skip, not a failure — ${out}`);
    assert(/could not be reached/.test(out), `it names what happened, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.bare, 'rev-parse', 'gh-pages'], { encoding: 'utf8' }).stdout.trim(), before,
      'the published branch is exactly where it was');
    assert(spawnSync('git', ['-C', world.tower, 'branch', '--list', 'gh-pages'], { encoding: 'utf8' }).stdout.trim() !== '',
      'and the local branch was not dropped on the way to a push that could never land');
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

  await test('a source push that does not land still publishes the site, and is the exit code', () => {
    const world = mkWorld();
    // A remote that refuses every ref but the published branch: the source
    // push cannot land, the pages push can.
    const hook = path.join(world.bare, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, [
      '#!/bin/sh',
      'while read old new ref; do',
      '  [ "$ref" = "refs/heads/gh-pages" ] || exit 1',
      'done',
      'exit 0',
      '',
    ].join('\n'));
    fs.chmodSync(hook, 0o755);
    fs.writeFileSync(world.source, '# the tower, edited\n');
    const { code, out, err } = publish(world);
    assertEq(code, 1, `the failed push surfaces as the exit code — ${out}${err}`);
    assert(/could not push main/.test(out + err), `the failure is said out loud, got: ${out}${err}`);
    const pages = fromPages(world);
    assert(pages, 'the site still published');
    assert(fs.existsSync(path.join(pages, 'index.html')), 'and carries the build');
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
