//
// Tests for workflow/publish.sh — building the dashboard and publishing it from
// the home repo (issue #27).
//
// The script is run from a COPIED checkout, never this one: a real run would
// invoke the omega build, and the suite must never do that. The copy carries the
// engine and the tower libs the snapshot reads, and its build tooling is a stub
// `omega` binary plus an `npm` shim that writes the output a build would leave.
// The home repo is a local bare repo (WORKKIT_HOME_REMOTE), so the push lands in
// a directory on this machine.
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
 * A world: a copied checkout, a scratch HOME and ~/.workkit, a bare "GitHub",
 * and the two shims a publish needs.
 *
 * `tooling: false` leaves the omega binary out — the machine without the sibling
 * omega checkout, where `npm install` exits 0 and still leaves nothing that can
 * build (probed 2026-07-28).
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
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });

  // The engine and the libs the snapshot reads, copied so the run's KIT_DIR is
  // the copy and never this checkout.
  fs.mkdirSync(path.join(kit, 'tower'), { recursive: true });
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'workflow'), kit]);
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'tower', 'api'), path.join(kit, 'tower')]);
  fs.mkdirSync(path.join(kit, 'tower', 'app', 'apps', 'web'), { recursive: true });
  if (tooling) writeStub(path.join(kit, 'tower', 'app', 'node_modules', '.bin', 'omega'), ['exit 0']);

  // The build: an `npm --prefix <app> run build` that leaves what a build leaves.
  const dist = path.join(kit, 'tower', 'app', 'apps', 'web', 'dist');
  writeStub(path.join(bin, 'npm'), buildFails
    ? ['printf \'omega: build failed\\n\' >&2', 'exit 1']
    : [
      'prefix=""',
      'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
      'mkdir -p "$prefix/apps/web/dist/assets"',
      'printf \'<html>the board</html>\\n\' > "$prefix/apps/web/dist/index.html"',
      'printf \'body{}\\n\' > "$prefix/apps/web/dist/assets/app.css"',
      'exit 0',
    ]);

  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { encoding: 'utf8' });

  const settings = { version: 1, repos: {}, ...(home ? { home: 'owner/workkit' } : {}) };
  fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  const env = {
    HOME: homeDir,
    PATH: `${bin}:${BASE_PATH}:${path.dirname(process.execPath)}`,
    WORKFLOW_HOME: workflowHome,
    WORKKIT_HOME_REMOTE: bare,
  };

  // The clone, made the way setup makes it, so the publish meets the folder it
  // will meet in production.
  if (home) {
    const driver = [
      'set -euo pipefail',
      `. ${JSON.stringify(path.join(kit, 'workflow', 'lib.sh'))}`,
      `. ${JSON.stringify(path.join(kit, 'workflow', 'discussions.sh'))}`,
      `. ${JSON.stringify(path.join(kit, 'workflow', 'home.sh'))}`,
      'wk_home_convert owner/workkit',
      'wk_home_write_files',
      'wk_home_commit_push "chore(home): the schema files"',
    ].join('\n');
    spawnSync('bash', ['-c', driver], { env, encoding: 'utf8' });
    if (siteUrl !== null || board) {
      const config = JSON.parse(fs.readFileSync(path.join(workflowHome, 'workkit.json'), 'utf8'));
      if (siteUrl !== null) config.site.url = siteUrl;
      config.site.board = board;
      fs.writeFileSync(path.join(workflowHome, 'workkit.json'), `${JSON.stringify(config, null, 2)}\n`);
    }
  }

  return {
    root,
    kit,
    bare,
    site: path.join(workflowHome, 'docs'),
    workflowHome,
    dist,
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

/** What a fresh clone of the home repo actually carries. */
const fromRemote = (world) => {
  const check = path.join(world.root, `check-${Math.random().toString(36).slice(2)}`);
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

  await test('no build tooling is a named skip that says what is missing', () => {
    // The honest signal: `npm install` in the app EXITS 0 on a machine without
    // the sibling omega checkout and leaves dangling symlinks, so the presence
    // of the binary is the only thing worth checking.
    const world = mkWorld({ tooling: false });
    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/node_modules\/\.bin\/omega/.test(out), `it names what is missing, got: ${out}`);
    assert(/file: spec/.test(out), 'and why it is missing');
    assert(!fs.existsSync(path.join(world.site, 'index.html')), 'nothing is published');
    cleanup(world.root);
  });

  await test('a folder pointing at another remote publishes nothing', () => {
    const world = mkWorld({ home: false });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    git(world.workflowHome, 'init', '-q', '-b', 'main');
    git(world.workflowHome, 'remote', 'add', 'origin', theirs);
    fs.writeFileSync(
      path.join(world.workflowHome, 'settings.json'),
      `${JSON.stringify({ version: 1, repos: {}, home: 'owner/workkit' }, null, 2)}\n`,
    );
    world.env.WORKKIT_HOME_REMOTE = world.bare;

    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/another remote/.test(out), `it says why, got: ${out}`);
    cleanup(world.root);
  });

  await test('a build that fails exits non-zero with its last lines', () => {
    const world = mkWorld({ buildFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, 'the caller can tell a failure from a skip');
    assert(/build failed/.test(out + err), `and sees what the build said, got: ${out}${err}`);
    cleanup(world.root);
  });

  group('workflow/publish: the published site');

  await test('the built dashboard is committed and pushed to the home repo', () => {
    const world = mkWorld();
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);

    assertEq(fs.readFileSync(path.join(world.site, 'index.html'), 'utf8'), '<html>the board</html>\n', 'the build is in docs/');
    assert(fs.existsSync(path.join(world.site, '.nojekyll')), 'with .nojekyll, so Pages serves it as it is');

    const clone = fromRemote(world);
    assert(fs.existsSync(path.join(clone, 'docs', 'index.html')), 'and a fresh clone carries the site');
    assert(fs.existsSync(path.join(clone, 'docs', 'assets', 'app.css')), 'assets and all');
    const subject = spawnSync('git', ['-C', clone, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    assert(/^chore\(site\): publish \d{4}-\d{2}-\d{2}$/.test(subject), `one conventional subject, got: ${subject}`);
    cleanup(world.root);
  });

  await test('the board snapshot is baked in beside the pages when the owner says so', () => {
    const world = mkWorld({ board: true });
    publish(world);
    const snapshot = JSON.parse(fs.readFileSync(path.join(world.site, 'data', 'board.json'), 'utf8'));
    assert(typeof snapshot.generatedAt === 'string', 'it is stamped');
    assert(Array.isArray(snapshot.repos), 'it names the roster it swept');
    assert(snapshot.board && typeof snapshot.board.ok === 'boolean', 'and carries the board with its own ok');
    const clone = fromRemote(world);
    assert(fs.existsSync(path.join(clone, 'docs', 'data', 'board.json')), 'and it travels with the site');
    cleanup(world.root);
  });

  await test('the board snapshot is OFF by default — Pages is public', () => {
    // GitHub Pages serves to anyone with the URL even from a private repo, and
    // the snapshot is every issue title across every repo on the roster.
    const world = mkWorld();
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(!fs.existsSync(path.join(world.site, 'data', 'board.json')), 'no snapshot is written');
    assert(fs.existsSync(path.join(world.site, 'index.html')), 'and the dashboard itself still publishes');
    const clone = fromRemote(world);
    assert(!fs.existsSync(path.join(clone, 'docs', 'data', 'board.json')), 'so nothing about the board is published');
    cleanup(world.root);
  });

  await test('turning the board off again un-publishes the snapshot', () => {
    const world = mkWorld({ board: true });
    publish(world);
    assert(fs.existsSync(path.join(world.site, 'data', 'board.json')), 'it was published');

    const config = JSON.parse(fs.readFileSync(path.join(world.workflowHome, 'workkit.json'), 'utf8'));
    config.site.board = false;
    fs.writeFileSync(path.join(world.workflowHome, 'workkit.json'), `${JSON.stringify(config, null, 2)}\n`);
    const { out } = publish(world);
    assert(/was removed/.test(out), `it says what it took away, got: ${out}`);
    assert(!fs.existsSync(path.join(world.site, 'data', 'board.json')), 'the file is gone locally');
    const clone = fromRemote(world);
    assert(!fs.existsSync(path.join(clone, 'docs', 'data', 'board.json')), 'and gone from what Pages serves');
    cleanup(world.root);
  });

  await test('a site.url becomes the CNAME, and clearing it removes the file', () => {
    const world = mkWorld({ siteUrl: 'https://board.example.com' });
    publish(world);
    assertEq(fs.readFileSync(path.join(world.site, 'CNAME'), 'utf8'), 'board.example.com\n', 'the scheme is not part of a CNAME');

    const config = JSON.parse(fs.readFileSync(path.join(world.workflowHome, 'workkit.json'), 'utf8'));
    config.site.url = null;
    fs.writeFileSync(path.join(world.workflowHome, 'workkit.json'), `${JSON.stringify(config, null, 2)}\n`);
    publish(world);
    assert(!fs.existsSync(path.join(world.site, 'CNAME')), 'clearing it takes the file away');
    cleanup(world.root);
  });

  await test('a publish that changed nothing writes no commit', () => {
    const world = mkWorld();
    publish(world);
    const before = spawnSync('git', ['-C', world.workflowHome, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    const { code, out } = publish(world);
    assertEq(code, 0, 'exit 0');
    assert(/already current/.test(out), `it says so, got: ${out}`);
    const after = spawnSync('git', ['-C', world.workflowHome, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assertEq(after, before, 'and the history is unchanged');
    cleanup(world.root);
  });

  await test('a page the build stopped shipping stops being published', () => {
    const world = mkWorld();
    publish(world);
    fs.writeFileSync(path.join(world.site, 'retired.html'), 'from an older build\n');
    publish(world);
    assert(!fs.existsSync(path.join(world.site, 'retired.html')), 'the published folder mirrors the build');
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
