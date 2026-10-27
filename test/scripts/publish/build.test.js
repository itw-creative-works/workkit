// Tests for workflow/publish/build.sh: the one home of the install, the mint
// and the build that turn a tower project into a built site. Each case drives
// the script whole against a scratch project with a stub `omega` inside it and
// an `npm` shim on PATH. No omega, no network.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, joinPath,
} = require('../../lib/platform');
const { REPO_ROOT, writeStub, readJson5 } = require('./helpers');

const SCRIPT = path.join(REPO_ROOT, 'workflow', 'publish', 'build.sh');
const SIDEBAR_REL = path.join('targets', 'web', 'src', '_includes', 'backend', 'sections', 'sidebar.json');
const APP_SIDEBAR = path.join(REPO_ROOT, 'tower', 'app', SIDEBAR_REL);
const SIDEBAR_WARNING = 'sidebar: site.sidebar is not a list of groups; the built-in sidebar is published';

const readLog = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  : []);

/**
 * A scratch project and the two tools build.sh reaches. The npm shim records
 * `<cwd>|<argv>|<OMEGA_PATH_PREFIX>` and the omega stub `<cwd>|<argv>`.
 * `installExit` is what `npm install` exits with. `mint` is `logo` (exit 0 and
 * a logo folder), `nothing` (exit 0, no logo) or `fails` (says why, exit 3).
 * `build` is `dist` (exit 0 and the output folder), `nothing` or `fails`.
 * The project carries the app's own sidebar.json; `site` is the `site` block
 * of the user's settings file, which is written only when it is given. The
 * build copies the sidebar it was handed to `builtSidebar`.
 */
const mkProject = ({
  installExit = 0, mint = 'logo', build = 'dist', site = null,
} = {}) => {
  const root = mkTmp('workkit-build-');
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(project, 'targets', 'web'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const sidebar = path.join(project, SIDEBAR_REL);
  fs.mkdirSync(path.dirname(sidebar), { recursive: true });
  fs.copyFileSync(APP_SIDEBAR, sidebar);
  const userDir = path.join(home, '.workkit');
  if (site) {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'settings.json'), `${JSON.stringify({ version: 1, site }, null, 2)}\n`);
  }

  const npmLog = path.join(root, 'npm.log');
  const builtSidebar = path.join(root, 'built-sidebar.json');
  writeStub(path.join(bin, 'npm'), [
    `printf '%s|%s|%s\\n' "$PWD" "$*" "\${OMEGA_PATH_PREFIX:-unset}" >> ${JSON.stringify(shellPath(npmLog))}`,
    `if [[ "$1" == install ]]; then exit ${installExit}; fi`,
    'prefix="$2"',
    `cp "$prefix/src/_includes/backend/sections/sidebar.json" ${JSON.stringify(shellPath(builtSidebar))}`,
    ...({
      dist: ['mkdir -p "$prefix/dist"', 'exit 0'],
      nothing: ['exit 0'],
      fails: ['printf \'omega: the build could not resolve a page\\n\' >&2', 'exit 1'],
    })[build],
  ]);

  const mintLog = path.join(root, 'mint.log');
  writeStub(path.join(project, 'node_modules', '.bin', 'omega'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
    ...({
      logo: ['mkdir -p "$PWD/.omega/assets/logo/brandmark"', 'exit 0'],
      nothing: ['exit 0'],
      fails: ['printf \'omega: the brandmark could not be read\\n\' >&2', 'exit 3'],
    })[mint],
  ]);

  return {
    root,
    project,
    sidebar,
    builtSidebar,
    npms: () => readLog(npmLog),
    mints: () => readLog(mintLog),
    env: homeEnv(home, { PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR), WORKFLOW_HOME: shellPath(userDir) }),
  };
};

// Run from the scratch root, never the project, so a step that lands in the
// project got there by entering it.
const build = (world, args) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd: world.root, env: world.env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `build.sh finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The one stderr line a refusal prints, which must open with `opening`.
const assertOneLine = (err, opening, what) => {
  const lines = err.trim().split('\n');
  assertEq(lines.length, 1, `${what} prints one stderr line, got: ${err}`);
  assert(lines[0].startsWith(opening), `${what} opens with "${opening}", got: ${lines[0]}`);
};

// One user group of two links, and the sidebar it should publish: the app's
// file with the group appended to `links` the way the app spells a group, a
// `{ header: true, label }` row followed by its links.
const ADS = {
  header: 'Ads',
  links: [
    { label: 'Generate', href: '/ads/generate', icon: 'fa-solid fa-bullhorn' },
    { label: 'Library', href: '/ads/library', icon: 'fa-solid fa-photo-film' },
  ],
};
const withAds = () => {
  const app = readJson5(APP_SIDEBAR);
  return { ...app, links: [...app.links, { header: true, label: ADS.header }, ...ADS.links] };
};

// Key order is the writer's business; the data is what the sidebar renders.
const canon = (value) => {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  }
  return value;
};
const assertSidebar = (file, expected, what) => {
  assertEq(JSON.stringify(canon(readJson5(file))), JSON.stringify(canon(expected)), what);
};

const assertAppSidebar = (world, what) => {
  assert(fs.readFileSync(world.sidebar).equals(fs.readFileSync(APP_SIDEBAR)), what);
};

const assertBuilt = (world, code, out) => {
  assertEq(code, 0, `the build goes on and exits 0: ${out}`);
  assert(world.npms().some((line) => line.split('|')[1].endsWith('run build')), `the build ran: ${world.npms().join(' | ')}`);
  assert(fs.existsSync(path.join(world.project, 'targets', 'web', 'dist')), 'and the output is there');
};

const cases = async () => {
  group('workflow/publish/build.sh: install');

  await test('install runs npm install with the project dir as the working directory', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['install', shellPath(world.project)]);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const npms = world.npms();
    assertEq(npms.length, 1, `one npm call: ${npms.join(' | ')}`);
    assertEq(npms[0].split('|').slice(0, 2).join('|'), `${shellPath(world.project)}|install`,
      'npm install, run inside the project');

    const failing = mkProject({ installExit: 7 });
    assertEq(build(failing, ['install', shellPath(failing.project)]).code, 7, 'and the exit is npm’s own');
  });

  group('workflow/publish/build.sh: mint');

  await test('mint runs the project’s own omega at the project, and a minted logo is success', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['mint', shellPath(world.project)]);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const mints = world.mints();
    assertEq(mints.length, 1, `one call of the project’s omega: ${mints.join(' | ')}`);
    assert(mints[0].startsWith(`${shellPath(world.project)}|`), `run at the project, got: ${mints[0]}`);
  });

  await test('a mint that exits 0 and leaves no logo folder exits 1 and says so', () => {
    const world = mkProject({ mint: 'nothing' });
    const { code, err } = build(world, ['mint', shellPath(world.project)]);
    assertEq(code, 1, `exit 1: ${err}`);
    assertOneLine(err, 'build: the mint left no logo at', 'the missing logo');
  });

  await test('a mint that fails exits non-zero with its own output shown', () => {
    const world = mkProject({ mint: 'fails' });
    const { code, out, err } = build(world, ['mint', shellPath(world.project)]);
    assert(code !== 0, `non-zero: ${out}${err}`);
    assert(err.includes('omega: the brandmark could not be read'), `what the mint said passes through, got: ${out}${err}`);
  });

  group('workflow/publish/build.sh: build');

  await test('build hands the prefix to the build as OMEGA_PATH_PREFIX and succeeds when dist exists', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const npms = world.npms();
    assertEq(npms.length, 1, `one npm call: ${npms.join(' | ')}`);
    const [, argv, prefix] = npms[0].split('|');
    assertEq(argv, `--prefix ${shellPath(world.project)}/targets/web run build`, 'the web target’s build script');
    assertEq(prefix, '/x/', 'the build was told the prefix the site serves at');
    assert(fs.existsSync(path.join(world.project, 'targets', 'web', 'dist')), 'and the output is there');
  });

  await test('a build that exits 0 and leaves no dist exits 1 and says so', () => {
    const world = mkProject({ build: 'nothing' });
    const { code, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertEq(code, 1, `exit 1: ${err}`);
    assertOneLine(err, 'build: the build left no output at', 'the missing output');
  });

  await test('a build that fails exits non-zero with its own output shown', () => {
    const world = mkProject({ build: 'fails' });
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assert(code !== 0, `non-zero: ${out}${err}`);
    assert(err.includes('omega: the build could not resolve a page'), `what the build said passes through, got: ${out}${err}`);
  });

  group('workflow/publish/build.sh: site.sidebar');

  await test('one group of two links is appended after the last built-in group, each link whole', () => {
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] } });
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    assert(!`${out}${err}`.includes(SIDEBAR_WARNING), `a valid group draws no warning, got: ${out}${err}`);
    assertSidebar(world.builtSidebar, withAds(),
      'the build saw the app\'s sidebar, then the group\'s header row, then its two links with label, href and icon');
    assertAppSidebar(world, 'after build.sh exits the clone\'s file is the app\'s again, byte for byte');
  });

  await test('each row the build adds to the app\'s sidebar parses as JSON on its own', () => {
    // The app's own file is JSON5 (comments, bare keys), so the added rows are
    // what can be held to JSON: each object after the app's text, parsed strictly.
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] } });
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    const text = fs.readFileSync(world.builtSidebar, 'utf8');
    const at = text.lastIndexOf(ADS.header);
    assert(at >= 0, `the merged file holds the group's header, got: ${text}`);
    let i = text.lastIndexOf('{', at);
    const rows = [];
    while (rows.length < 1 + ADS.links.length) {
      while (/[\s,]/.test(text[i])) i += 1;
      assertEq(text[i], '{', `row ${rows.length + 1} opens an object in: ${text.slice(i - 40, i + 200)}`);
      let depth = 0;
      let end = i;
      do {
        if (text[end] === '{') depth += 1;
        if (text[end] === '}') depth -= 1;
        end += 1;
      } while (depth > 0 && end < text.length);
      const row = text.slice(i, end);
      try {
        rows.push(JSON.parse(row));
      } catch (e) {
        throw new Error(`row ${rows.length + 1} is not JSON: ${row} (${e.message})`);
      }
      i = end;
    }
    assertEq(JSON.stringify(canon(rows)), JSON.stringify(canon([{ header: true, label: ADS.header }, ...ADS.links])),
      'the header row, then the two links, each whole');
  });

  await test('no site.sidebar leaves the clone\'s sidebar.json byte-identical to the app\'s', () => {
    const world = mkProject({ site: { repo: 'owner/workkit' } });
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    assert(!`${out}${err}`.includes(SIDEBAR_WARNING), `an absent key draws no warning, got: ${out}${err}`);
    assert(fs.readFileSync(world.sidebar).equals(fs.readFileSync(APP_SIDEBAR)), 'the file is the app\'s, byte for byte');
  });

  await test('a site.sidebar that is not an array, or a group with no links array, warns and publishes the app\'s sidebar', () => {
    const values = [
      { what: 'a group object, not an array', sidebar: ADS },
      { what: 'a group with no links key, beside a valid one', sidebar: [ADS, { header: 'Broken' }] },
      { what: 'a group whose links is not an array', sidebar: [{ header: 'Ads', links: 'Generate' }] },
    ];
    for (const { what, sidebar } of values) {
      const world = mkProject({ site: { repo: 'owner/workkit', sidebar } });
      const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
      assert(`${out}${err}`.includes(SIDEBAR_WARNING), `${what}: the warning is printed, got: ${out}${err}`);
      assert(fs.readFileSync(world.sidebar).equals(fs.readFileSync(APP_SIDEBAR)), `${what}: the file is the app's, byte for byte`);
      assertBuilt(world, code, `${what}: ${out}${err}`);
    }
  });

  await test('a second build with the same groups holds them once', () => {
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] } });
    for (const pass of ['first', 'second']) {
      const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
      assertEq(code, 0, `the ${pass} build exits 0: ${out}${err}`);
    }
    assertSidebar(world.builtSidebar, withAds(), 'the second build saw the group once after the built-ins, not twice');
    assertAppSidebar(world, 'after the second build exits the clone\'s file is the app\'s again, byte for byte');
  });

  group('workflow/publish/build.sh: usage');

  await test('a build with no prefix, an unknown verb and an install with no dir are usage errors', () => {
    const world = mkProject();
    const calls = [
      ['build', shellPath(world.project)],
      ['nope', shellPath(world.project)],
      ['install'],
    ];
    for (const args of calls) {
      const { code, err } = build(world, args);
      assertEq(code, 2, `build.sh ${args.join(' ')} exits 2: ${err}`);
      assertOneLine(err, 'usage: build.sh', `build.sh ${args.join(' ')}`);
    }
    assertEq(world.npms().length + world.mints().length, 0, 'and no tool ran for any of them');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
