// Tests for workflow/publish/build.js: the one home of the install, the mint
// and the build that turn a tower project into a built site. Each case starts
// the file whole with `node` against a scratch project with a stub `omega`
// inside it and an `npm` shim on PATH. No omega, no network.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, start, until,
} = require('../../lib/harness');
const {
  SYSTEM_PATH, NODE_DIR, shellPath, homeEnv, joinPath, samePath, skipWithoutCaughtSignal,
} = require('../../lib/platform');
const {
  REPO_ROOT, writeStub, readJson5, binDirWithout,
} = require('./helpers');

const SCRIPT = path.join(REPO_ROOT, 'workflow', 'publish', 'build.js');
const SIDEBAR_REL = path.join('targets', 'web', 'src', '_includes', 'backend', 'sections', 'sidebar.json');
const APP_SIDEBAR = path.join(REPO_ROOT, 'tower', 'app', SIDEBAR_REL);
const SIDEBAR_WARNING = 'sidebar: site.sidebar is not a list of groups; the built-in sidebar is published';

const readLog = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  : []);

/**
 * A scratch project and the two tools build.js reaches. The npm shim records
 * `<cwd>|<argv>|<OMEGA_PATH_PREFIX>` and the omega stub `<cwd>|<argv>`.
 * `installExit` is what `npm install` exits with. `mint` is `logo` (exit 0 and
 * a logo folder), `nothing` (exit 0, no logo) or `fails` (says why, exit 3).
 * `build` is `dist` (exit 0 and the output folder), `nothing` or `fails`.
 * The project carries the app's own sidebar.json; `site` is the `site` block
 * of the user's settings file, which is written only when it is given. The
 * build copies the sidebar it was handed to `builtSidebar`. `app` is the text
 * of a scratch app's sidebar.json, handed in as WORKKIT_TOWER_APP in place of
 * this checkout's tower/app.
 */
const mkProject = ({
  installExit = 0, mint = 'logo', build = 'dist', site = null, app = null,
} = {}) => {
  const root = mkTmp('workkit-build-');
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(project, 'targets', 'web'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const appDir = path.join(root, 'app');
  const appSidebar = app === null ? APP_SIDEBAR : path.join(appDir, SIDEBAR_REL);
  if (app !== null) {
    fs.mkdirSync(path.dirname(appSidebar), { recursive: true });
    fs.writeFileSync(appSidebar, app);
  }
  const sidebar = path.join(project, SIDEBAR_REL);
  fs.mkdirSync(path.dirname(sidebar), { recursive: true });
  fs.copyFileSync(appSidebar, sidebar);
  const userDir = path.join(home, '.workkit');
  if (site) {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'settings.json'), `${JSON.stringify({ version: 1, site }, null, 2)}\n`);
  }

  const npmLog = path.join(root, 'npm.log');
  const builtSidebar = path.join(root, 'built-sidebar.json');
  // A held build says so in `held`, then waits until the case writes `go`, or
  // until its scratch folder is gone, so a failed case leaves no stand-in behind.
  const held = path.join(root, 'held');
  const go = path.join(root, 'go');
  writeStub(path.join(bin, 'npm'), [
    `printf '%s|%s|%s\\n' "$PWD" "$*" "\${OMEGA_PATH_PREFIX:-unset}" >> ${JSON.stringify(shellPath(npmLog))}`,
    `if [[ "$1" == install ]]; then exit ${installExit}; fi`,
    'prefix="$2"',
    `cp "$prefix/src/_includes/backend/sections/sidebar.json" ${JSON.stringify(shellPath(builtSidebar))}`,
    ...({
      dist: ['mkdir -p "$prefix/dist"', 'exit 0'],
      nothing: ['exit 0'],
      fails: ['printf \'omega: the build could not resolve a page\\n\' >&2', 'exit 1'],
      hold: [
        `: > ${JSON.stringify(shellPath(held))}`,
        `while [[ ! -e ${JSON.stringify(shellPath(go))} && -d ${JSON.stringify(shellPath(root))} ]]; do sleep 0.1; done`,
        'mkdir -p "$prefix/dist"',
        'exit 0',
      ],
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
    appSidebar,
    builtSidebar,
    held,
    go,
    npms: () => readLog(npmLog),
    mints: () => readLog(mintLog),
    // Native: build.js is started here, not by Git Bash, which alone converts a shell spelling.
    env: homeEnv(home, {
      PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: userDir,
      ...(app === null ? {} : { WORKKIT_TOWER_APP: appDir }),
    }),
  };
};

// Run from the scratch root, never the project, so a step that lands in the
// project got there by entering it.
const build = (world, args) => {
  const res = run(process.execPath, [SCRIPT, ...args], { cwd: world.root, env: world.env });
  expect(!res.timedOut, 'build.js finished (no timeout)').toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// Two spellings of one folder, as a shell and Node each write it on Windows.
const sameDir = (a, b) => samePath(a, b, process.platform);

// The one stderr line a refusal prints, which must open with `opening`.
const assertOneLine = (err, opening, what) => {
  const lines = err.trim().split('\n');
  expect(lines.length, `${what} prints one stderr line, got: ${err}`).toBe(1);
  expect(lines[0].startsWith(opening), `${what} opens with "${opening}", got: ${lines[0]}`).toBeTruthy();
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
  expect(JSON.stringify(canon(readJson5(file))), what).toBe(JSON.stringify(canon(expected)));
};

const assertAppSidebar = (world, what) => {
  expect(fs.readFileSync(world.sidebar).equals(fs.readFileSync(world.appSidebar)), what).toBeTruthy();
};

const assertBuilt = (world, code, out) => {
  expect(code, `the build goes on and exits 0: ${out}`).toBe(0);
  expect(world.npms().some((line) => line.split('|')[1].endsWith('run build')), `the build ran: ${world.npms().join(' | ')}`).toBeTruthy();
  expect(fs.existsSync(path.join(world.project, 'targets', 'web', 'dist')), 'and the output is there').toBeTruthy();
};

describe('workflow/publish/build.js: install', () => {
  test('install runs npm install with the project dir as the working directory', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['install', world.project]);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    const npms = world.npms();
    expect(npms.length, `one npm call: ${npms.join(' | ')}`).toBe(1);
    const [cwd, argv] = npms[0].split('|');
    expect(sameDir(cwd, world.project), `npm install, run inside the project, got: ${npms[0]}`).toBeTruthy();
    expect(argv, 'npm install, nothing more').toBe('install');

    const failing = mkProject({ installExit: 7 });
    expect(build(failing, ['install', failing.project]).code, 'and the exit is npm’s own').toBe(7);
  });

  test('with no npm on PATH, install names the program it could not start and answers 1', () => {
    const world = mkProject();
    const { code, out, err } = build({ ...world, env: { ...world.env, PATH: binDirWithout('npm') } }, ['install', world.project]);
    expect(code, `exit 1: ${out}${err}`).toBe(1);
    assertOneLine(err, 'build: could not start npm', 'the program that never started');
  });
});

describe('workflow/publish/build.js: mint', () => {
  test('mint runs the project’s own omega at the project, and a minted logo is success', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['mint', world.project]);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    const mints = world.mints();
    expect(mints.length, `one call of the project’s omega: ${mints.join(' | ')}`).toBe(1);
    expect(sameDir(mints[0].split('|')[0], world.project), `run at the project, got: ${mints[0]}`).toBeTruthy();
  });

  test('a mint that exits 0 and leaves no logo folder exits 1 and says so', () => {
    const world = mkProject({ mint: 'nothing' });
    const { code, err } = build(world, ['mint', world.project]);
    expect(code, `exit 1: ${err}`).toBe(1);
    assertOneLine(err, 'build: the mint left no logo at', 'the missing logo');
  });

  test('a mint that fails exits non-zero with its own output shown', () => {
    const world = mkProject({ mint: 'fails' });
    const { code, out, err } = build(world, ['mint', world.project]);
    expect(code !== 0, `non-zero: ${out}${err}`).toBeTruthy();
    expect(err.includes('omega: the brandmark could not be read'), `what the mint said passes through, got: ${out}${err}`).toBeTruthy();
  });
});

describe('workflow/publish/build.js: build', () => {
  test('build hands the prefix to the build as OMEGA_PATH_PREFIX and succeeds when dist exists', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['build', world.project, '/x/']);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    const npms = world.npms();
    expect(npms.length, `one npm call: ${npms.join(' | ')}`).toBe(1);
    const [, argv, prefix] = npms[0].split('|');
    const words = argv.split(' ');
    expect(words.length === 4 && words[0] === '--prefix' && words.slice(2).join(' ') === 'run build',
      `the web target’s build script, got: ${argv}`).toBeTruthy();
    expect(sameDir(words[1], path.join(world.project, 'targets', 'web')), `in the web target, got: ${argv}`).toBeTruthy();
    expect(prefix, 'the build was told the prefix the site serves at').toBe('/x/');
    expect(fs.existsSync(path.join(world.project, 'targets', 'web', 'dist')), 'and the output is there').toBeTruthy();
  });

  test('a build that exits 0 and leaves no dist exits 1 and says so', () => {
    const world = mkProject({ build: 'nothing' });
    const { code, err } = build(world, ['build', world.project, '/x/']);
    expect(code, `exit 1: ${err}`).toBe(1);
    assertOneLine(err, 'build: the build left no output at', 'the missing output');
  });

  test('a build that fails exits non-zero with its own output shown', () => {
    const world = mkProject({ build: 'fails' });
    const { code, out, err } = build(world, ['build', world.project, '/x/']);
    expect(code !== 0, `non-zero: ${out}${err}`).toBeTruthy();
    expect(err.includes('omega: the build could not resolve a page'), `what the build said passes through, got: ${out}${err}`).toBeTruthy();
  });
});

describe('workflow/publish/build.js: site.sidebar', () => {
  test('one group of two links is appended after the last built-in group, each link whole', () => {
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] } });
    const { code, out, err } = build(world, ['build', world.project, '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    expect(!`${out}${err}`.includes(SIDEBAR_WARNING), `a valid group draws no warning, got: ${out}${err}`).toBeTruthy();
    assertSidebar(world.builtSidebar, withAds(),
      'the build saw the app\'s sidebar, then the group\'s header row, then its two links with label, href and icon');
    assertAppSidebar(world, 'after build.js exits the clone\'s file is the app\'s again, byte for byte');
  });

  test('each row the build adds to the app\'s sidebar parses as JSON on its own', () => {
    // The app's own file is JSON5 (comments, bare keys), so the added rows are
    // what can be held to JSON: each object after the app's text, parsed strictly.
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] } });
    const { code, out, err } = build(world, ['build', world.project, '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    const text = fs.readFileSync(world.builtSidebar, 'utf8');
    const at = text.lastIndexOf(ADS.header);
    expect(at >= 0, `the merged file holds the group's header, got: ${text}`).toBeTruthy();
    let i = text.lastIndexOf('{', at);
    const rows = [];
    while (rows.length < 1 + ADS.links.length) {
      while (/[\s,]/.test(text[i])) i += 1;
      expect(text[i], `row ${rows.length + 1} opens an object in: ${text.slice(i - 40, i + 200)}`).toBe('{');
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
    expect(JSON.stringify(canon(rows)), 'the header row, then the two links, each whole').toBe(JSON.stringify(canon([{ header: true, label: ADS.header }, ...ADS.links])));
  });

  test('no site.sidebar leaves the clone\'s sidebar.json byte-identical to the app\'s', () => {
    const world = mkProject({ site: { repo: 'owner/workkit' } });
    const { code, out, err } = build(world, ['build', world.project, '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    expect(!`${out}${err}`.includes(SIDEBAR_WARNING), `an absent key draws no warning, got: ${out}${err}`).toBeTruthy();
    expect(fs.readFileSync(world.sidebar).equals(fs.readFileSync(APP_SIDEBAR)), 'the file is the app\'s, byte for byte').toBeTruthy();
  });

  test('a site.sidebar that is not an array, or a group with no links array, warns and publishes the app\'s sidebar', () => {
    const values = [
      { what: 'a group object, not an array', sidebar: ADS },
      { what: 'a group with no links key, beside a valid one', sidebar: [ADS, { header: 'Broken' }] },
      { what: 'a group whose links is not an array', sidebar: [{ header: 'Ads', links: 'Generate' }] },
    ];
    for (const { what, sidebar } of values) {
      const world = mkProject({ site: { repo: 'owner/workkit', sidebar } });
      const { code, out, err } = build(world, ['build', world.project, '/x/']);
      expect(`${out}${err}`.includes(SIDEBAR_WARNING), `${what}: the warning is printed, got: ${out}${err}`).toBeTruthy();
      expect(fs.readFileSync(world.sidebar).equals(fs.readFileSync(APP_SIDEBAR)), `${what}: the file is the app's, byte for byte`).toBeTruthy();
      assertBuilt(world, code, `${what}: ${out}${err}`);
    }
  });

  test('a second build with the same groups holds them once', () => {
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] } });
    for (const pass of ['first', 'second']) {
      const { code, out, err } = build(world, ['build', world.project, '/x/']);
      expect(code, `the ${pass} build exits 0: ${out}${err}`).toBe(0);
    }
    assertSidebar(world.builtSidebar, withAds(), 'the second build saw the group once after the built-ins, not twice');
    assertAppSidebar(world, 'after the second build exits the clone\'s file is the app\'s again, byte for byte');
  });
});

// An app sidebar whose last row has no comma, with a comment above the list's
// close: the merge adds the comma, keeps every comment, and writes each row as
// one line of JSON before the `]`.
const SCRATCH_APP = [
  '// The scratch nav, a comment the merge keeps.',
  '{',
  "  logo: { href: '/' },",
  '  links: [',
  '    // the group\'s own note',
  "    { header: true, label: 'Main' },",
  "    { label: 'Home', href: '/' }",
  '    // the last row carries no comma',
  '  ],',
  '}',
  '',
].join('\n');
const SCRATCH_MERGED = [
  '// The scratch nav, a comment the merge keeps.',
  '{',
  "  logo: { href: '/' },",
  '  links: [',
  '    // the group\'s own note',
  "    { header: true, label: 'Main' },",
  "    { label: 'Home', href: '/' },",
  '    // the last row carries no comma',
  '    {"header":true,"label":"Ads"},',
  '    {"label":"Generate","href":"/ads/generate","icon":"fa-solid fa-bullhorn"},',
  '    {"label":"Library","href":"/ads/library","icon":"fa-solid fa-photo-film"},',
  '  ],',
  '}',
  '',
].join('\n');

describe('workflow/publish/build.js: the sidebar merge', () => {
  test('the rows land before the list\'s closing ], the app\'s text and comments kept', () => {
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] }, app: SCRATCH_APP });
    const { code, out, err } = build(world, ['build', world.project, '/x/']);
    assertBuilt(world, code, `${out}${err}`);
    expect(fs.readFileSync(world.builtSidebar, 'utf8'), 'the build saw the app\'s file with the rows spliced in').toBe(SCRATCH_MERGED);
    assertAppSidebar(world, 'and the clone\'s file is the app\'s again, byte for byte');
  });

  test('a build ended by SIGTERM while it runs still puts the app\'s bytes back', {
    skip: skipWithoutCaughtSignal(),
  }, async (t) => {
    const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] }, app: SCRATCH_APP, build: 'hold' });
    t.after(() => { if (fs.existsSync(world.root)) fs.writeFileSync(world.go, ''); });
    const call = start(process.execPath, [SCRIPT, 'build', world.project, '/x/'], { cwd: world.root, env: world.env });
    expect(await until(() => fs.existsSync(world.held)), `the build was reached: ${call.output()}`).toBeTruthy();
    expect(fs.readFileSync(world.sidebar, 'utf8'), 'the clone holds the merged file while the build runs').toBe(SCRATCH_MERGED);

    // The step in hand ends once the held build is let go; the run must stop
    // there, by the signal, rather than finish.
    process.kill(call.pid, 'SIGTERM');
    fs.writeFileSync(world.go, '');
    const { signal } = await call.done;
    expect(signal, `build.js ended by the signal it was sent: ${call.output()}`).toBe('SIGTERM');
    assertAppSidebar(world, 'and the clone\'s file is the app\'s again, byte for byte');
  });

  test('a build that fails still puts the app\'s bytes back', () => {
    for (const how of ['fails', 'nothing']) {
      const world = mkProject({ site: { repo: 'owner/workkit', sidebar: [ADS] }, app: SCRATCH_APP, build: how });
      const { code, out, err } = build(world, ['build', world.project, '/x/']);
      expect(code !== 0, `the ${how} build fails: ${out}${err}`).toBeTruthy();
      expect(fs.readFileSync(world.builtSidebar, 'utf8'), `the ${how} build saw the merged file`).toBe(SCRATCH_MERGED);
      assertAppSidebar(world, `after the ${how} build the clone's file is the app's again, byte for byte`);
    }
  });
});

describe('workflow/publish/build.js: usage', () => {
  test('a build with no prefix, an unknown verb and an install with no dir are usage errors', () => {
    const world = mkProject();
    const calls = [
      ['build', world.project],
      ['nope', world.project],
      ['install'],
    ];
    for (const args of calls) {
      const { code, err } = build(world, args);
      expect(code, `build.js ${args.join(' ')} exits 2: ${err}`).toBe(2);
      assertOneLine(err, 'usage: build.js', `build.js ${args.join(' ')}`);
    }
    expect(world.npms().length + world.mints().length, 'and no tool ran for any of them').toBe(0);
  });
});
