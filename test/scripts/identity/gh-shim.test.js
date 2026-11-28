// Tests for workflow/identity/gh: the shim that hands the real `gh` the App's
// token for the bookkeeping verbs on a rostered repo inside a Claude session, or
// refuses with the client's code and message, and whose gate judges the expanded
// call (the leak scan always, the label and filing gates in a Claude session) and
// journals each write. Each case runs a scratch copy of the kit against a stub `gh`
// that records its argv and GH_TOKEN; the token comes from a cache file or a
// local token-service stand-in, so nothing reaches GitHub.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, start, until, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, skipWithoutNodeStub, skipWithoutFileLink, skipWithoutCaughtSignal, shellPath, gitPath, jsPath, which, spawnBash,
  systemPathWith, joinPath, homeEnv, nodeTempEnv, basePathWithout, stubToolJs,
} = require('../../lib/platform');
const {
  eqArgv, fmtCalls, recordArgvJs, readArgv,
} = require('../../lib/argv-log');
const { olderNode, recordingNode } = require('../../lib/node-fakes');
const {
  makeGhStub, ghCalls, ghEnvs, ghRequests, pathWithoutGh,
} = require('../../lib/gh-stub');
const { mkOriginRepo, OPT_IN_SHAPES } = require('../../lib/git-repo');
const { mkRosterHome } = require('../../lib/roster');
const {
  INSTALL_FIX, PRESELECTED, BOT_HINT, deviceFlowRoutes, userRoute, writeLogin, readWrittenLogin, useTokenService, startServer, startService,
  scratchKit, shimArgv, hostsOf, PTY, atTerminal, journalFile, journalLines,
} = require('../../lib/identity');
const { plantPkgRecord } = require('../../lib/suite-record');
const { BLOCK: PROOF_BLOCK, QA_BLOCK } = require('../../hooks/proof-guard/helpers');

// The client's cache, one token per repo, so a token names the repo it was read for.
const CACHED = {
  'acme--rostered': 'ghs_testtoken',
  'other--rostered': 'ghs_othertoken',
  'acme--unrostered': 'ghs_unrosteredtoken',
};

// A token URL nothing listens on, for the worlds whose cases never reach the service.
const NO_SERVICE = 'http://127.0.0.1:9/token';

/**
 * A scratch kit, three repos and a home whose roster enables two of them:
 * `rostered` (acme/rostered) and `other` (other/rostered); `unrostered`
 * (acme/unrostered) is on no roster. `signedIn: false` leaves no login file,
 * `cache: false` leaves the client nothing cached, and `tokenUrl` is the
 * service the settings name.
 */
const mkWorld = ({ signedIn = true, cache = true, tokenUrl = NO_SERVICE } = {}) => {
  const root = mkTmp('wk-gh-shim-');
  const kit = scratchKit();

  const repo = (name, slug) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    return mkOriginRepo(dir, `https://github.com/${slug}.git`);
  };
  const rostered = repo('rostered', 'acme/rostered');
  const other = repo('other', 'other/rostered');
  const unrostered = repo('unrostered', 'acme/unrostered');

  const home = mkRosterHome([[rostered, 'enabled'], [other, 'enabled']]);
  useTokenService(home, tokenUrl);
  if (signedIn) writeLogin(home, { token: 'ghu_owneruser', login: 'owner' });
  if (cache) {
    const cacheDir = path.join(home, '.workkit', 'identity');
    fs.mkdirSync(cacheDir, { recursive: true });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (const [name, token] of Object.entries(CACHED)) {
      fs.writeFileSync(path.join(cacheDir, `${name}.json`), JSON.stringify({ token, expiresAt }), { mode: 0o600 });
    }
  }
  return {
    root, shim: path.join(kit, 'workflow', 'identity', 'gh'), home, rostered, other, unrostered,
  };
};

/**
 * Run the shim with `args` from `cwd` (the rostered repo by default), PATH the
 * shim's folder, any `extraDirs`, the stub's, then node; `claude: false` leaves
 * CLAUDECODE unset, `env` adds variables, and `noJq` swaps the system part for
 * node's folder and a mirror holding no jq. Neither token name is in the env, so null means unset.
 * `keyboard: true` runs it at script's terminal, `stderr` then all it showed.
 * `remote` is CLAUDE_CODE_REMOTE (unset by default); `api`, when given, the stub's `gh api` routes.
 * `field` and `issues` are the stub's view fixtures, `input` the shim's stdin, and
 * `script`, when given, a bash command line run in place of the shim, `gh` on PATH being it.
 * `tempDir`, when given, is the temp folder in every name Node reads one by, HOME then native.
 */
const runShim = (world, args, {
  claude = true, cwd = world.rostered, env: extra = {}, extraDirs = [], noJq = false, keyboard = false,
  remote, api = null, field = 'body', issues = { 1: 'x' }, input, script, tempDir,
} = {}) => {
  // The stub holds one issue fixture by default, so a view of it answers the way gh does.
  const stub = makeGhStub({
    env: ['GH_TOKEN', 'GH_REPO'], field, issues, api,
  });
  const dirs = [path.dirname(world.shim), ...extraDirs, stub.binDir];
  const env = homeEnv(world.home, {
    PATH: noJq
      ? [...dirs, NODE_DIR, basePathWithout(world.root, 'jq')].join(path.delimiter)
      : systemPathWith(...dirs, NODE_DIR),
    ...(claude ? { CLAUDECODE: '1' } : {}),
    ...(remote === undefined ? {} : { CLAUDE_CODE_REMOTE: remote }),
    ...extra,
  });
  if (noJq) expect(which('jq', env.PATH), 'the world\'s PATH holds no jq').toBe(null);
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  if (!('GH_REPO' in extra)) delete env.GH_REPO;
  if (tempDir) Object.assign(env, nodeTempEnv(tempDir), { HOME: world.home });
  if (keyboard) {
    const res = atTerminal([BASH, ...shimArgv(world.shim, args)], { env, cwd, dir: world.root });
    return {
      code: res.status, stderr: res.terminal, calls: ghCalls(stub), envs: ghEnvs(stub),
    };
  }
  // A moved temp folder moves Git Bash's /tmp, so that run finds the shim by name, never by a /tmp path.
  let argv = shimArgv(world.shim, args);
  if (tempDir) argv = [...NO_RC, '-c', 'gh "$@"', 'gh', ...args];
  if (script !== undefined) argv = [...NO_RC, '-c', script];
  const res = spawnBash(argv, {
    cwd, env, input, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  return {
    code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', calls: ghCalls(stub), envs: ghEnvs(stub), requests: ghRequests(stub),
  };
};

// A planted .env value, and the gate's bounces as the guards word them.
const SECRET = 'sup3rSecretValue_9f2a';
const TOKEN = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
const LEAK = (what) => `issue-guard: BLOCKED this gh command: the outbound text carries ${what}.`;
const ENV_LEAK = LEAK('the value of API_SECRET from a local .env file');
const SPEC_BLOCK = (n) => `spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract`;
const FINDINGS_BLOCK = 'findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo.';
const QA_FLIP = ['issue', 'edit', '7', '--add-label', 'status:qa'];
const NO_PROOF = { field: 'comments', issues: { 7: [{ body: 'looks good to me' }], 9: [{ body: 'looks good to me' }] } };
const PROVED = { field: 'comments', issues: { 7: [{ body: 'Proof: unit: npm test -- test/a.test.js' }] } };

/**
 * mkWorld with the rostered repo opted in and committed: its settings, a root
 * package.json declaring a test script, and a .env holding SECRET as API_SECRET.
 * `touched: true` leaves an untracked test file, test/a.test.js, no record covers.
 */
const mkGateWorld = ({ touched = false } = {}) => {
  const world = mkWorld();
  const git = (...args) => {
    const res = spawnSync('git', args, { cwd: world.rostered, encoding: 'utf8', env: homeEnv(world.home, { PATH: process.env.PATH }) });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  };
  const files = {
    '.workkit/settings.json': OPT_IN_SHAPES.current,
    'package.json': '{ "private": true, "scripts": { "test": "workkit test" } }\n',
    '.env': `API_SECRET=${SECRET}\n`,
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(world.rostered, rel)), { recursive: true });
    fs.writeFileSync(path.join(world.rostered, rel), body);
  }
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  if (touched) {
    fs.mkdirSync(path.join(world.rostered, 'test'));
    fs.writeFileSync(path.join(world.rostered, 'test', 'a.test.js'), 'module.exports = async () => ({ passed: 1, failed: 0 });\n');
  }
  return world;
};

/** The journal's lines for the world's rostered repo. */
const journal = (world) => journalLines(path.join(world.home, '.workkit'), world.rostered);

/** The calls the stub saw that were `argv` itself, not the gate's own reads. */
const callsOf = (res, argv) => res.calls.filter((c) => eqArgv(c, argv));

/** The gate refused: exit 1, `text` on stderr, and the real gh never ran `argv`. */
const assertBounced = (res, argv, text, what) => {
  expect(res.code, `${what}: the exit (stderr: ${res.stderr.trim()})`).toBe(1);
  expect(res.stderr.includes(text), `${what}: stderr carries the bounce, got: ${res.stderr}`).toBeTruthy();
  expect(callsOf(res, argv).length, `${what}: the real gh never ran it, got ${fmtCalls(res.calls)}`).toBe(0);
};

/** The real `gh` ran once, exit 0, with `argv` whole and GH_TOKEN `token` (null: unset). */
const assertRan = (res, argv, token, what) => {
  expect(res.code, `${what}: the exit (stderr: ${res.stderr.trim()})`).toBe(0);
  expect(res.calls.length, `${what}: the real gh runs once, got ${fmtCalls(res.calls)}`).toBe(1);
  expect(eqArgv(res.calls[0], argv), `${what}: every argument passed through, got ${fmtCalls(res.calls)}`).toBeTruthy();
  expect(res.envs[0].GH_TOKEN, `${what}: GH_TOKEN`).toBe(token);
};

/**
 * assertRan for a write the gate may read around in a Claude session: the real
 * gh ran `argv` once, with GH_TOKEN `token`, and every other call it saw was the
 * gate's own `issue view`.
 */
const assertWrote = (res, argv, token, what) => {
  expect(res.code, `${what}: the exit (stderr: ${res.stderr.trim()})`).toBe(0);
  const at = res.calls.map((c, i) => (eqArgv(c, argv) ? i : -1)).filter((i) => i >= 0);
  expect(at.length, `${what}: the real gh ran it once, got ${fmtCalls(res.calls)}`).toBe(1);
  expect(res.envs[at[0]].GH_TOKEN, `${what}: GH_TOKEN`).toBe(token);
  const others = res.calls.filter((c, i) => i !== at[0] && !(c[0] === 'issue' && c[1] === 'view'));
  expect(others.length, `${what}: no other call but the gate's view, got ${fmtCalls(res.calls)}`).toBe(0);
};

/**
 * `gh <args>` through the shim from the rostered repo, a `gh` ahead of the stub
 * on PATH that the shim takes for the real one: it prints `real-gh: <argv>`, and
 * the calling shell prints `code: <exit>` after it: `lines` are that output in
 * write order, `ran` the hook's mark, null when no hook ran.
 */
const runRealGh = (world, args, opts = {}) => {
  const realGh = path.join(world.root, 'real-gh');
  fs.mkdirSync(realGh, { recursive: true });
  stubToolJs(realGh, 'gh', "console.log(`real-gh: ${process.argv.slice(2).join(' ')}`);");
  const out = shellPath(path.join(world.root, 'real-gh.log'));
  const call = args.map((a) => `'${a}'`).join(' ');
  const res = runShim(world, [], { ...opts, extraDirs: [realGh], script: `gh ${call} > '${out}' 2>&1; echo "code: $?" >> '${out}'` });
  const marks = path.join(world.rostered, 'ran.txt');
  const lines = fs.readFileSync(path.join(world.root, 'real-gh.log'), 'utf8').split('\n').filter(Boolean);
  expect(res.code === 0, `the calling shell finished, got: ${res.stderr}`).toBeTruthy();
  return { lines, ran: fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8') : null };
};

/**
 * A real `gh` in `<dir>` that reads the body it was handed, as gh reads one
 * (`-` and `@-` from stdin, else the file named), and records `{ body, token }`;
 * `take()` answers that record and clears it, null with none. `<dir>` goes on a run's `extraDirs`.
 */
const bodyReader = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const record = path.join(dir, 'read.json');
  stubToolJs(dir, 'gh', [
    "const fs = require('fs');",
    'const args = process.argv.slice(2);',
    "const from = (v) => fs.readFileSync(v === '-' ? 0 : v, 'utf8');",
    'let body = null;',
    'for (let i = 0; i < args.length; i += 1) {',
    '  const [flag, inline] = args[i].split(/=(.*)/s);',
    "  if (!['--body-file', '--input', '-F', '--field'].includes(flag)) continue;",
    '  const value = inline === undefined ? args[(i += 1)] : inline;',
    "  const field = /^([^=]+)=@(.*)$/s.exec(value);",
    "  body = field ? from(field[2]) : from(value);",
    '}',
    `fs.writeFileSync(${jsPath(record)}, JSON.stringify({ body, token: process.env.GH_TOKEN ?? null }));`,
  ].join('\n'));
  const take = () => {
    if (!fs.existsSync(record)) return null;
    const got = JSON.parse(fs.readFileSync(record, 'utf8'));
    fs.rmSync(record);
    return got;
  };
  return { dir, take };
};

/** Every file under `dir` whose text holds `text`. */
const heldIn = (dir, text) => fs.readdirSync(dir, { recursive: true }).map((rel) => path.join(dir, rel))
  .filter((f) => fs.statSync(f).isFile() && fs.readFileSync(f, 'utf8').includes(text));

// The line the shim prints under a Node that reads as v20.15.1.
const FLOOR_LINE = 'workkit: this Node is v20.15.1; the kit needs 22.22 or newer';

/** The env pair making every node under it read as v20.15.1 to the code it runs. */
const olderNodeEnv = (dir) => ({ NODE_OPTIONS: `--require ${jsPath(olderNode('20.15.1', dir))}` });

/**
 * A `node` in `<dir>`, put first on PATH, that records each start and runs the
 * suite's own node on the same arguments, a preload making every Node process
 * under it record itself too: `{ dir, starts(), nodes() }`, each a list of argv.
 */
const countingNode = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const [starts, nodes, preload] = ['starts.log', 'nodes.log', 'count.js'].map((name) => path.join(dir, name));
  fs.writeFileSync(preload, `${recordArgvJs(jsPath(nodes), 'process.argv.slice(1)')}\n`);
  recordingNode(dir, { log: starts, preload, everyNode: true });
  return { dir, starts: () => readArgv(starts), nodes: () => readArgv(nodes) };
};

describe('identity/gh: the owner\'s own calls', () => {
  test('case 15: outside a Claude session, gh issue list runs the real gh with no GH_TOKEN', async () => {
    const world = mkWorld();
    assertRan(runShim(world, ['issue', 'list'], { claude: false }), ['issue', 'list'], null, 'gh issue list');
  });
});

describe('identity/gh: the bot\'s bookkeeping', () => {
  test('case 15: on a rostered repo the bookkeeping verbs get the client\'s token, the rest run as the owner', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment), comment, 'ghs_testtoken', 'gh issue comment, repo from the cwd');

    const byFlag = ['issue', 'comment', '1', '--body', 'x', '--repo', 'other/rostered'];
    assertRan(runShim(world, byFlag), byFlag, 'ghs_othertoken', 'gh issue comment --repo, repo from the flag');
    const byShortFlag = ['issue', 'comment', '1', '--body', 'x', '-R', 'other/rostered'];
    assertRan(runShim(world, byShortFlag), byShortFlag, 'ghs_othertoken', 'gh issue comment -R, repo from the flag');

    const prComment = ['pr', 'comment', '3', '--body', 'x'];
    assertRan(runShim(world, prComment), prComment, 'ghs_testtoken', 'gh pr comment');

    const asOwner = [
      ['pr', 'merge', '3', '--squash'],
      ['release', 'create', 'v1.0.0'],
      ['api', 'repos/acme/rostered/issues/1/comments', '-f', 'body=x'],
      ['auth', 'token'],
    ];
    for (const argv of asOwner) assertRan(runShim(world, argv), argv, null, `gh ${argv.join(' ')}`);
  });

  test('case 15: on a repo not on the roster, a bookkeeping verb runs with no GH_TOKEN', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { cwd: world.unrostered }), comment, null, 'gh issue comment');
  });

  test('case 15: GH_REPO names the repo when no flag does, and -R beats it', async () => {
    const world = mkWorld();
    const opts = { cwd: world.unrostered, env: { GH_REPO: 'other/rostered' } };
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, opts), comment, 'ghs_othertoken', 'GH_REPO from an unrostered cwd');
    const byFlag = ['issue', 'comment', '1', '--body', 'x', '-R', 'acme/rostered'];
    assertRan(runShim(world, byFlag, opts), byFlag, 'ghs_testtoken', '-R over GH_REPO');
  });

  test('case 15: an issue URL argument names the repo gh acts on, over the cwd\'s origin', async () => {
    const world = mkWorld();
    const byUrl = ['issue', 'comment', 'https://github.com/other/rostered/issues/1', '--body', 'x'];
    assertRan(runShim(world, byUrl), byUrl, 'ghs_othertoken', 'gh issue comment <url> from acme/rostered');
  });

  test('a pull request URL after a boolean flag names the repo: gh pr review --approve <url> gets that repo\'s token, from any cwd', async () => {
    const world = mkWorld();
    const review = ['pr', 'review', '--approve', 'https://github.com/other/rostered/pull/3'];
    assertRan(runShim(world, review), review, 'ghs_othertoken', 'gh pr review --approve <url> from acme/rostered');
    assertRan(runShim(world, review, { cwd: world.unrostered }), review, 'ghs_othertoken',
      'gh pr review --approve <url> from acme/unrostered');
  });

  test('an issue URL after a boolean flag names the repo: gh issue comment --edit-last <url> --body x gets that repo\'s token', async () => {
    const world = mkWorld();
    const edit = ['issue', 'comment', '--edit-last', 'https://github.com/other/rostered/issues/7', '--body', 'x'];
    assertRan(runShim(world, edit), edit, 'ghs_othertoken', 'gh issue comment --edit-last <url> from acme/rostered');
  });

  test('a URL with a fragment or a trailing path still names the repo: #issuecomment-<n> and /pull/<n>/files get that repo\'s token', async () => {
    const world = mkWorld();
    const calls = [
      ['issue', 'comment', 'https://github.com/other/rostered/issues/7#issuecomment-123', '--body', 'x'],
      ['pr', 'review', 'https://github.com/other/rostered/pull/3/files', '--approve'],
    ];
    for (const argv of calls) assertRan(runShim(world, argv), argv, 'ghs_othertoken', `gh ${argv.join(' ')} from acme/rostered`);
  });

  test('a URL that is a body or title flag\'s whole value names no repo; a boolean flag\'s neighbour still does', async () => {
    const world = mkWorld();
    const values = [
      ['issue', 'comment', '5', '--body', 'https://github.com/other/rostered/issues/3'],
      ['issue', 'create', '--title', 'https://github.com/other/rostered/issues/3', '--body', 'x'],
    ];
    for (const argv of values) assertRan(runShim(world, argv), argv, 'ghs_testtoken', `gh ${argv.join(' ')} from acme/rostered`);
    const review = ['pr', 'review', '--approve', 'https://github.com/other/rostered/pull/3'];
    assertRan(runShim(world, review), review, 'ghs_othertoken', 'gh pr review --approve <url> from acme/rostered');
  });

  test('a bare verb or a help flag runs the real gh as the owner and never asks the client, signed in or not', async () => {
    const helps = [['issue'], ['label', '-h'], ['issue', 'comment', '--help']];
    // The stand-in is the token service, so a call that asked the client would show as a request.
    const service = await startService(200, { token: 'ghs_never', expires_at: '2099-01-01T00:00:00Z' });
    try {
      const signedIn = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
      for (const argv of helps) assertRan(runShim(signedIn, argv), argv, null, `signed in, gh ${argv.join(' ')}`);
      expect(service.requests().length, `the client never asked the service, got: ${JSON.stringify(service.requests())}`).toBe(0);
    } finally {
      await service.close();
    }
    // Not signed in, a call that reached the client would exit 3; the stub's own 0 means gh answered.
    const signedOut = mkWorld({ signedIn: false, cache: false });
    for (const argv of helps) assertRan(runShim(signedOut, argv), argv, null, `not signed in, gh ${argv.join(' ')}`);
  });

  test('gh issue list and gh pr create still run as the owner on a rostered repo', async () => {
    const world = mkWorld();
    for (const argv of [['issue', 'list'], ['pr', 'create']]) assertRan(runShim(world, argv), argv, null, `gh ${argv.join(' ')}`);
  });

  test('case 15: gh pr revert and gh pr update-branch run as the owner on a rostered repo', async () => {
    const world = mkWorld();
    for (const argv of [['pr', 'revert', '3'], ['pr', 'update-branch', '3']]) {
      assertRan(runShim(world, argv), argv, null, `gh ${argv.join(' ')}`);
    }
  });

  test('case 17a: the reads run the real gh once with no GH_TOKEN on a rostered repo, signed in or not', async () => {
    const reads = [['issue', 'list'], ['issue', 'view', '1'], ['label', 'list'], ['pr', 'checks', '3'], ['pr', 'status']];
    for (const [label, world] of [['signed in', mkWorld()], ['not signed in', mkWorld({ signedIn: false, cache: false })]]) {
      for (const argv of reads) assertRan(runShim(world, argv), argv, null, `${label}, gh ${argv.join(' ')}`);
    }
  });

  test('case 17b: a github.com URL inside a body or title value\'s prose names no repo; the cwd\'s token is taken', async () => {
    const world = mkWorld();
    const calls = [
      ['issue', 'comment', '5', '--body', 'https://github.com/other/thing/issues/3 is related'],
      ['issue', 'comment', '5', '-b', 'https://github.com/other/thing/issues/3 is related'],
      ['issue', 'create', '--title', 'https://github.com/other/x/pull/1 follow-up', '--body', 'b'],
    ];
    for (const argv of calls) assertRan(runShim(world, argv), argv, 'ghs_testtoken', `gh ${argv.join(' ')}`);
  });

  test('case 17c: -R and GH_REPO given as a github.com URL or host/owner/name read as owner/name', async () => {
    const world = mkWorld();
    for (const value of ['https://github.com/other/rostered', 'github.com/other/rostered']) {
      const argv = ['issue', 'comment', '1', '--body', 'x', '-R', value];
      assertRan(runShim(world, argv), argv, 'ghs_othertoken', `-R ${value} from acme/rostered`);
    }
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { env: { GH_REPO: 'github.com/other/rostered' } }), comment, 'ghs_othertoken',
      'GH_REPO=github.com/other/rostered from acme/rostered');
    for (const value of ['https://github.com/acme/rostered', 'github.com/acme/rostered']) {
      const argv = ['issue', 'comment', '1', '--body', 'x', '-R', value];
      assertRan(runShim(world, argv, { cwd: world.unrostered }), argv, 'ghs_testtoken', `-R ${value} from acme/unrostered`);
    }
    assertRan(runShim(world, comment, { cwd: world.unrostered, env: { GH_REPO: 'github.com/acme/rostered' } }), comment,
      'ghs_testtoken', 'GH_REPO=github.com/acme/rostered from acme/unrostered');
  });
});

describe('identity/gh: the escape hatch and the PATH', () => {
  test('case 15: WORKKIT_IDENTITY_OFF=1 runs the real gh with no token, even for bookkeeping on a rostered repo', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { env: { WORKKIT_IDENTITY_OFF: '1' } }), comment, null, 'gh issue comment');
  });

  test('case 15: a PATH holding a second copy of the shim\'s folder still reaches the real gh in time', async () => {
    const world = mkWorld();
    // A second kit, since a shim loads its gate and libraries from its own kit.
    const second = path.join(world.root, 'second');
    fs.cpSync(path.dirname(path.dirname(path.dirname(world.shim))), second, { recursive: true });
    const list = ['issue', 'list'];
    assertRan(runShim(world, list, { claude: false, extraDirs: [path.join(second, 'workflow', 'identity')] }), list, null,
      'gh issue list past two shims');
  });

  test('node shim case 2: a bookkeeping call the gate lets through starts one Node process besides the real gh, by the node a fake first on PATH counts', async () => {
    const world = mkWorld();
    const node = countingNode(path.join(world.root, 'counting-node'));
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { extraDirs: [node.dir] }), comment, 'ghs_testtoken', 'gh issue comment past the counting node');
    expect(node.starts().length, `node started once, got: ${node.starts().join(' | ')}`).toBe(1);
    expect(node.nodes().length, `one Node process in all, got: ${node.nodes().join(' | ')}`).toBe(1);
  });

  test('node shim case 5: a link to workflow/identity/gh in a folder of its own, run by its path, runs the kit\'s shim: a bookkeeping call gets its token', { skip: skipWithoutFileLink() }, async () => {
    const world = mkWorld();
    const bin = path.join(world.root, 'local-bin');
    fs.mkdirSync(bin);
    const link = path.join(bin, 'gh');
    fs.symlinkSync(world.shim, link);
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim({ ...world, shim: link }, comment), comment, 'ghs_testtoken', 'gh issue comment through the link');
  });
});

describe('identity/gh: the refusals', () => {
  test('case 16: not signed in, no terminal, a bookkeeping verb on a rostered repo exits 3 naming workkit setup --login, starts no sign-in, and gh never runs', async () => {
    // The stand-in is GitHub's sign-in host, so a device flow started here would show.
    const github = await startServer(deviceFlowRoutes({ userCode: 'SHIM-0016', accessToken: 'ghu_never', login: 'hubot' }),
      mkTmp('wk-gh-shim-github-'));
    try {
      const world = mkWorld({ signedIn: false, cache: false });
      const res = runShim(world, ['issue', 'comment', '1', '--body', 'x'],
        { env: hostsOf(github) });
      expect(res.code, `exit 3, stderr: ${res.stderr}`).toBe(3);
      expect(res.stderr.includes('workkit setup --login'), `stderr names workkit setup --login, got: ${res.stderr}`).toBeTruthy();
      expect(!res.stderr.includes('workkit login'), `and no longer workkit login, got: ${res.stderr}`).toBeTruthy();
      expect(github.requests().length, `no device-code request, got: ${JSON.stringify(github.requests())}`).toBe(0);
      expect(res.calls.length, `the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
    } finally {
      await github.close();
    }
  });

  test(
    'case 16a: not signed in at a terminal, the client\'s own sign-in reaches the person, then the real gh runs once with the service\'s token', { skip: !PTY && 'no `script` here to hand the shim a terminal' }, async () => {
      const stand = await startServer([
        ...deviceFlowRoutes({ userCode: 'SHIM-016A', accessToken: 'ghu_shimkeyboard', login: 'hubot' }),
        { method: 'POST', url: '/token', status: 200, body: JSON.stringify({ token: 'ghs_aftersignin', expires_at: '2099-01-01T00:00:00Z' }) },
      ], mkTmp('wk-gh-shim-stand-'));
      try {
        const world = mkWorld({ signedIn: false, cache: false, tokenUrl: `${stand.url}/token` });
        const comment = ['issue', 'comment', '1', '--body', 'x'];
        const res = runShim(world, comment, { keyboard: true, env: hostsOf(stand) });
        expect(res.stderr.includes('https://github.com/login/device'), `the terminal shows the device page, got: ${res.stderr}`).toBeTruthy();
        expect(res.stderr.includes('SHIM-016A'), `and the user code, got: ${res.stderr}`).toBeTruthy();
        const written = readWrittenLogin(world.home);
        expect(written.login, 'the login file holds the stand-in\'s login').toBe('hubot');
        expect(written.token, 'and its token').toBe('ghu_shimkeyboard');
        // The stub exits 0 on a comment, so the shim's 0 is the stub's, handed on by exec.
        assertRan(res, comment, 'ghs_aftersignin', 'gh issue comment after the sign-in');
        const posts = stand.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        expect(posts.length, `one service request, got: ${JSON.stringify(stand.requests())}`).toBe(1);
        expect(posts[0].auth, 'carrying the new sign-in\'s bearer').toBe('Bearer ghu_shimkeyboard');
      } finally {
        await stand.close();
      }
    },
  );

  test('case 17: the service answers 412, the verb exits 4 naming the install page pre-selected on the owner, then or run: workkit setup --bot, and gh never runs', async () => {
    // One stand-in is both the service and GitHub's API. It answers no repo read,
    // so the id comes from the public user read the owner falls back to.
    const service = await startServer([
      { method: 'POST', url: '/token', status: 412, body: JSON.stringify({ error: 'not installed', fix: INSTALL_FIX }) },
      userRoute('acme', 4242),
    ], mkTmp('wk-identity-service-'));
    try {
      const world = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
      const res = runShim(world, ['issue', 'comment', '1', '--body', 'x'], { env: { GITHUB_API_URL: service.url } });
      expect(res.code, `exit 4, stderr: ${res.stderr}`).toBe(4);
      expect(res.stderr.includes(`install workkit-agent[bot] on acme: ${PRESELECTED}4242\n${BOT_HINT}\n`),
        `stderr names the pre-selected page, then the --bot command, got: ${res.stderr}`).toBeTruthy();
      expect(res.calls.length, `the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
      const posts = service.requests().filter((r) => r.method === 'POST' && r.url === '/token');
      expect(posts.length > 0, `the client asked the stand-in, got: ${JSON.stringify(service.requests())}`).toBeTruthy();
    } finally {
      await service.close();
    }
  });

  test('node shim case 3: with no jq on PATH, a bookkeeping verb on a rostered repo gets its token and the real gh runs it', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { noJq: true }), comment, 'ghs_testtoken', 'gh issue comment with no jq');
  });

  test('node shim real gh: with no gh on PATH after the shim\'s folder, the call is the one line naming the shim, and 127', async () => {
    const world = mkWorld();
    const shimDir = path.dirname(world.shim);
    const after = joinPath(NODE_DIR, pathWithoutGh());
    expect(which('gh', after), 'the world holds no gh after the shim').toBe(null);
    const env = homeEnv(world.home, { PATH: joinPath(shimDir, after), CLAUDECODE: '1' });
    const res = spawnBash(shimArgv(world.shim, ['issue', 'list']), {
      cwd: world.rostered, env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `exit 127 (stderr: ${res.stderr})`).toBe(127);
    expect(res.stderr, 'the one line').toBe(`gh: no gh on PATH after the workkit shim at ${shimDir}/gh\n`);
  });

  test('node shim failure: a failure inside the shim, a kit whose package.json names no readable floor, is one gh: line and 1, never a stack, and gh never runs', async () => {
    const world = mkWorld();
    const kit = path.dirname(path.dirname(path.dirname(world.shim)));
    fs.writeFileSync(path.join(kit, 'package.json'), '{ "name": "workkit", "engines": {} }\n');
    const res = runShim(world, ['issue', 'list']);
    expect(res.code, `exit 1 (stderr: ${res.stderr})`).toBe(1);
    const lines = res.stderr.split('\n').filter(Boolean);
    expect(lines.length, `one line, got: ${res.stderr}`).toBe(1);
    expect(lines[0].startsWith('gh:'), `the line is the shim's, got: ${lines[0]}`).toBeTruthy();
    expect(/^\s+at /m.test(res.stderr), `no stack line, got: ${res.stderr}`).toBe(false);
    expect(res.calls.length, `the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
  });

  test('the shim relays the client\'s exit 1: a 403 and a 500 from the service each exit 1 with its message, and gh never runs', async () => {
    const answers = [
      [403, { error: 'no write access', fix: 'you need write access to acme/rostered to post as the bot' }, 'you need write access to acme/rostered to post as the bot'],
      [500, { error: 'github refused: Server Error from the stand-in', fix: 'try again shortly' }, 'Server Error from the stand-in'],
    ];
    for (const [status, body, message] of answers) {
      const service = await startService(status, body);
      try {
        const world = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
        const res = runShim(world, ['issue', 'comment', '1', '--body', 'x']);
        expect(res.code, `${status}: exit 1, stderr: ${res.stderr}`).toBe(1);
        expect(res.stderr.includes(message), `${status}: stderr carries the service's message, got: ${res.stderr}`).toBeTruthy();
        expect(res.calls.length, `${status}: the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
      } finally {
        await service.close();
      }
    }
  });

  test('node shim case 4: under a Node below the floor a Claude session\'s call prints the floor line and exits 1 in any folder, gh auth and WORKKIT_IDENTITY_OFF=1 reach the real gh, and outside a session the call reaches it with no line', async () => {
    const world = mkWorld();
    const older = olderNodeEnv(world.root);
    const view = ['issue', 'view', '1'];
    for (const [where, cwd] of [['the rostered repo', world.rostered], ['a folder in no repo', mkTmp('wk-gh-shim-norepo-')]]) {
      const res = runShim(world, view, { cwd, env: older });
      expect(res.code, `${where}: exit 1 (stderr: ${res.stderr.trim()})`).toBe(1);
      expect(res.stderr.includes(FLOOR_LINE), `${where}: stderr carries the floor line, got: ${res.stderr}`).toBeTruthy();
      expect(res.calls.length, `${where}: the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
    }
    const auth = ['auth', 'status'];
    assertRan(runShim(world, auth, { env: older }), auth, null, 'gh auth status under the older Node');
    assertRan(runShim(world, view, { env: { ...older, WORKKIT_IDENTITY_OFF: '1' } }), view, null,
      'gh issue view under WORKKIT_IDENTITY_OFF=1 and the older Node');
    const outside = runShim(world, view, { claude: false, env: older });
    assertRan(outside, view, null, 'gh issue view outside a Claude session under the older Node');
    expect(outside.stderr, 'outside a session no line is printed').toBe('');
  });
});

describe('identity/gh: a cloud session and off it', () => {
  test('case 9: off the cloud (CLAUDE_CODE_REMOTE unset or false) a verb the cloud translates runs the real gh once, whole, with no gh api call', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    for (const remote of [undefined, 'false']) {
      const res = runShim(world, comment, { cwd: world.unrostered, remote, api: {} });
      assertRan(res, comment, null, `CLAUDE_CODE_REMOTE=${remote}`);
      expect(res.requests.length, `CLAUDE_CODE_REMOTE=${remote}: no gh api call`).toBe(0);
    }
  });

  test('off the cloud a pr or release verb the cloud serves runs the real gh once, whole, with no gh api call', async () => {
    const world = mkWorld();
    for (const argv of [['pr', 'view', '12', '--json', 'number'], ['release', 'view', 'v1.0.0', '--json', 'tagName']]) {
      const res = runShim(world, argv, { cwd: world.unrostered, api: {} });
      assertRan(res, argv, null, argv.slice(0, 2).join(' '));
      expect(res.requests.length, `${argv.slice(0, 2).join(' ')}: no gh api call`).toBe(0);
    }
  });

  test('in the cloud gh pr and gh release reach GitHub as gh api calls alone, never the real gh\'s own pr or release, with no bot token', { skip: skipWithoutNodeStub() }, async () => {
    const pull = {
      number: 12, state: 'open', merged_at: null, html_url: 'https://github.com/acme/rostered/pull/12', head: { ref: 'claude/work', sha: 'a'.repeat(40) }, base: { ref: 'main' },
    };
    const api = {
      'GET repos/acme/rostered/pulls/12': { body: pull },
      'PUT repos/acme/rostered/pulls/12/merge': { body: { sha: 'c'.repeat(40), merged: true, message: 'Pull Request successfully merged' } },
      'GET repos/acme/rostered/releases/tags/v1.0.0': { body: { tag_name: 'v1.0.0', html_url: 'https://github.com/acme/rostered/releases/tag/v1.0.0' } },
    };
    for (const argv of [['pr', 'merge', '12', '--merge'], ['release', 'view', 'v1.0.0', '--json', 'tagName']]) {
      const what = argv.slice(0, 2).join(' ');
      const res = runShim(mkWorld(), argv, { remote: 'true', api });
      expect(res.code, `${what}: the exit (stderr: ${res.stderr.trim()})`).toBe(0);
      expect(res.calls.length > 0 && res.calls.every((c) => c[0] === 'api'), `${what}: only gh api runs, got ${fmtCalls(res.calls)}`).toBeTruthy();
      expect(res.envs.every((e) => e.GH_TOKEN === null), `${what}: no GH_TOKEN reaches gh, got: ${JSON.stringify(res.envs)}`).toBeTruthy();
    }
  });

  test('node shim cloud: a call rest.js passes on, gh issue develop 7 -R acme/x, reaches the real gh whole with GH_REPO the repo the shim read', { skip: skipWithoutNodeStub() }, async () => {
    const argv = ['issue', 'develop', '7', '-R', 'acme/x'];
    const res = runShim(mkWorld(), argv, { remote: 'true', api: {} });
    assertRan(res, argv, null, 'gh issue develop in the cloud');
    expect(res.envs[0].GH_REPO, 'the repo the shim read, from -R over the cwd\'s acme/rostered').toBe('acme/x');
  });

  test('in the cloud a verb the shim does not serve runs the real gh with the clone\'s repo as GH_REPO, so gh api placeholders resolve; off it GH_REPO stays unset', async () => {
    const world = mkWorld();
    const read = ['api', 'repos/{owner}/{repo}', '-q', '.default_branch'];
    const cloud = runShim(world, read, { cwd: world.unrostered, remote: 'true' });
    assertRan(cloud, read, null, 'gh api in the cloud');
    expect(cloud.envs[0].GH_REPO, 'the clone\'s origin, handed over').toBe('acme/unrostered');
    const local = runShim(world, read, { cwd: world.unrostered });
    assertRan(local, read, null, 'gh api off the cloud');
    expect(local.envs[0].GH_REPO, 'off the cloud gh reads the remote itself').toBe(null);
  });

  test('case 10: in the cloud a bookkeeping verb on a rostered repo never fetches the bot\'s token, cached or from the service', { skip: skipWithoutNodeStub() }, async () => {
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    const api = {
      'POST repos/acme/rostered/issues/1/comments': {
        status: 201,
        body: { id: 2001, html_url: 'https://github.com/acme/rostered/issues/1#issuecomment-2001', body: 'x', user: { login: 'owner' } },
      },
    };
    const asAccount = (res, what) => {
      expect(res.code, `${what}: the exit (stderr: ${res.stderr.trim()})`).toBe(0);
      expect(res.calls.length > 0 && res.calls.every((c) => c[0] === 'api'), `${what}: only gh api runs, got ${fmtCalls(res.calls)}`).toBeTruthy();
      expect(res.envs.every((e) => e.GH_TOKEN === null), `${what}: no GH_TOKEN reaches gh, got: ${JSON.stringify(res.envs)}`).toBeTruthy();
    };
    asAccount(runShim(mkWorld(), comment, { remote: 'true', api }), 'a cached token on disk');

    // The stand-in is the token service, so a call that asked the client would show as a request.
    const service = await startService(200, { token: 'ghs_never', expires_at: '2099-01-01T00:00:00Z' });
    try {
      const world = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
      asAccount(runShim(world, comment, { remote: 'true', api }), 'nothing cached');
      expect(service.requests().length, `the token service is never asked, got: ${JSON.stringify(service.requests())}`).toBe(0);
    } finally {
      await service.close();
    }
  });
});

describe('identity/gh: a paired public repo', () => {
  test('the shim posts public-repo writes as the bot for a paired repo, and leaves an unpaired outside repo to the owner\'s gh', async () => {
    const world = mkWorld();
    const settings = path.join(world.rostered, '.workkit', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, `${JSON.stringify({ enabled: true, public: 'acme/public' })}\n`);
    // Both outside repos hold a cached token, so only the pairing tells them apart.
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (const [name, token] of [['acme--public', 'ghs_publictoken'], ['acme--outside', 'ghs_outsidetoken']]) {
      fs.writeFileSync(path.join(world.home, '.workkit', 'identity', `${name}.json`), JSON.stringify({ token, expiresAt }), { mode: 0o600 });
    }
    const writes = (repo) => [
      ['issue', 'comment', '44', '--body', 'x', '-R', repo],
      ['issue', 'edit', '44', '--add-label', 'status:qa', '-R', repo],
      ['issue', 'close', '44', '-R', repo],
    ];
    for (const cwd of [world.rostered, world.unrostered]) {
      const where = cwd === world.rostered ? 'from the paired repo' : 'from an unrostered repo';
      for (const argv of writes('acme/public')) {
        assertWrote(runShim(world, argv, { cwd }), argv, 'ghs_publictoken', `gh ${argv.join(' ')} ${where}`);
      }
      for (const argv of writes('acme/outside')) {
        assertWrote(runShim(world, argv, { cwd }), argv, null, `gh ${argv.join(' ')} ${where}`);
      }
    }
  });
});

describe('identity/gh: the gate\'s leak scan, in every session', () => {
  test('case 1: gh issue comment 1 --body "$(cat .env)" outside a Claude session exits 1 naming the KEY, and the real gh never runs', async () => {
    const world = mkGateWorld();
    const res = runShim(world, [], { claude: false, script: 'gh issue comment 1 --body "$(cat .env)"' });
    expect(res.code, `the exit (stderr: ${res.stderr.trim()})`).toBe(1);
    expect(res.stderr.includes(ENV_LEAK), `stderr carries the issue-guard bounce naming API_SECRET, got: ${res.stderr}`).toBeTruthy();
    expect(!res.stderr.includes(SECRET), 'never echoes the value').toBeTruthy();
    expect(res.calls.length, `the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
  });

  test('env reader case 9: a .env value only Node\'s reader reads, in backticks, outside a Claude session exits 1 naming the KEY, and the real gh never runs', async () => {
    const world = mkGateWorld();
    const value = 'abc123xyz999';
    fs.writeFileSync(path.join(world.rostered, '.env'), `SERVICE_ID=\`${value}\`\n`);
    const res = runShim(world, ['issue', 'comment', '1', '--body', `it failed with ${value} today`], { claude: false });
    expect(res.code, `the exit (stderr: ${res.stderr.trim()})`).toBe(1);
    expect(res.stderr.includes(LEAK('the value of SERVICE_ID from a local .env file')), `stderr carries the issue-guard bounce naming SERVICE_ID, got: ${res.stderr}`).toBeTruthy();
    expect(!res.stderr.includes(value), 'never echoes the value').toBeTruthy();
    expect(res.calls.length, `the real gh never runs, got ${fmtCalls(res.calls)}`).toBe(0);
  });

  test('case 2: the .env value in a --body-file file and in a --body-file - stdin body both bounce, and no copy of the stdin body is left behind', async () => {
    const world = mkGateWorld();
    const file = path.join(mkTmp('wk-gh-gate-body-'), 'body.md');
    fs.writeFileSync(file, `## Description\n\nthe key is ${SECRET}\n`);
    const fromFile = ['issue', 'comment', '1', '--body-file', file];
    assertBounced(runShim(world, fromFile, { claude: false }), fromFile, ENV_LEAK, 'a --body-file file');

    const tmp = mkTmp('wk-gh-gate-tmp-');
    const fromStdin = ['issue', 'comment', '1', '--body-file', '-'];
    const res = runShim(world, fromStdin, { claude: false, input: `the key is ${SECRET}\n`, tempDir: tmp });
    assertBounced(res, fromStdin, ENV_LEAK, 'a --body-file - stdin body');
    expect(heldIn(tmp, SECRET).join(', '), 'no file under the temp folder still holds the stdin body').toBe('');
  });

  test('case 2: the .env value in a gh api --input file, a gh api --field key=@file and a gh issue comment -F file each bounce', async () => {
    const world = mkGateWorld();
    fs.writeFileSync(path.join(world.rostered, 'body.json'), `${JSON.stringify({ body: `the key is ${SECRET}` })}\n`);
    fs.writeFileSync(path.join(world.rostered, 'body.txt'), `the key is ${SECRET}\n`);
    const calls = [
      ['api', '-X', 'POST', 'repos/acme/rostered/issues/7/comments', '--input', 'body.json'],
      ['api', '-X', 'POST', 'repos/acme/rostered/issues/7/comments', '--field', 'body=@body.txt'],
      ['issue', 'comment', '7', '-F', 'body.txt'],
    ];
    for (const argv of calls) assertBounced(runShim(world, argv, { claude: false }), argv, ENV_LEAK, `gh ${argv.join(' ')}`);
  });

  test('case 3: a ghp_ token in gh pr create --body bounces; a clean gh issue comment runs the real gh with its argv unchanged', async () => {
    const world = mkGateWorld();
    const create = ['pr', 'create', '--title', 'fix', '--body', `use ${TOKEN} to retry`];
    const res = runShim(world, create, { claude: false });
    assertBounced(res, create, LEAK('a GitHub token-shaped string'), 'gh pr create with a token');
    expect(!res.stderr.includes(TOKEN), 'never echoes the match').toBeTruthy();
    const clean = ['issue', 'comment', '1', '--body', 'specced, building now'];
    assertRan(runShim(world, clean, { claude: false }), clean, null, 'a clean gh issue comment');
  });

  test('gh secret set, gh variable set and a gh api PUT to actions/secrets carry the .env value to GitHub\'s store and run; a comment carrying it still bounces', async () => {
    const world = mkGateWorld();
    const stores = [
      ['secret', 'set', 'FOO', '--body', SECRET],
      ['variable', 'set', 'FOO', '--body', SECRET],
      ['api', '-X', 'PUT', 'repos/acme/rostered/actions/secrets/FOO', '-f', `encrypted_value=${SECRET}`],
      ['api', '-X', 'POST', 'repos/acme/rostered/actions/variables', '-f', 'name=FOO', '-f', `value=${SECRET}`],
      ['api', '-X', 'PATCH', 'repos/acme/rostered/actions/variables/FOO', '-f', `value=${SECRET}`],
    ];
    for (const argv of stores) assertRan(runShim(world, argv), argv, null, `gh ${argv.slice(0, 4).join(' ')}`);
    const comment = ['issue', 'comment', '7', '--body', SECRET];
    assertBounced(runShim(world, comment), comment, ENV_LEAK, 'the comment carrying the value');
  });
});

describe('identity/gh: the gate\'s label and filing gates, in a Claude session', () => {
  test('case 4: a flip to status:qa with no Proof: comment and an unrecorded test file bounces; proved and recorded, it runs and journals one line', async () => {
    const world = mkGateWorld({ touched: true });
    const bounced = runShim(world, QA_FLIP, NO_PROOF);
    assertBounced(bounced, QA_FLIP, QA_BLOCK(1, 'the repo root: test/a.test.js'), 'the unproved flip');
    expect(journal(world).length, 'a bounced call journals nothing').toBe(0);

    plantPkgRecord(path.join(world.home, '.workkit'), world.rostered, ['.']);
    const before = Date.now();
    const res = runShim(world, QA_FLIP, PROVED);
    const after = Date.now();
    expect(res.code, `the proved flip passes (stderr: ${res.stderr.trim()})`).toBe(0);
    expect(callsOf(res, QA_FLIP).length, `the real gh ran the flip once, got ${fmtCalls(res.calls)}`).toBe(1);
    const lines = journal(world);
    expect(lines.length, `one journal line, got: ${JSON.stringify(lines)}`).toBe(1);
    const [ms, ...fields] = lines[0];
    expect(Number(ms) >= before && Number(ms) <= after, `the line's epoch ms falls within the call, got: ${ms}`).toBeTruthy();
    expect(JSON.stringify(fields), 'verb, sub, repo, numbers, labels added and removed, cwd').toBe(JSON.stringify(['issue', 'edit', 'acme/rostered', '7', 'status:qa', '', gitPath(world.rostered)]));
  });

  test('case 5: a gh api POST adding status:qa to an issue\'s labels gets the same bounce; a gh api read passes and journals nothing', async () => {
    const world = mkGateWorld({ touched: true });
    const post = ['api', '-X', 'POST', 'repos/acme/rostered/issues/7/labels', '-f', 'labels[]=status:qa'];
    assertBounced(runShim(world, post, NO_PROOF), post, QA_BLOCK(1, 'the repo root: test/a.test.js'), 'the REST flip');
    const read = ['api', 'repos/acme/rostered'];
    assertRan(runShim(world, read), read, null, 'gh api repos/acme/rostered');
    expect(journal(world).length, `neither call journals a line, got: ${JSON.stringify(journal(world))}`).toBe(0);
  });

  test('case 6: a flip to status:specced on a Spec with no Contract gets the spec-guard bounce; a review notes create with findings.file off gets the findings-guard bounce', async () => {
    const world = mkGateWorld();
    const specced = ['issue', 'edit', '7', '--add-label', 'status:specced'];
    const body = { field: 'body', issues: { 7: '## Description\n\nX.\n\n## Spec\n\nBuild the thing, carefully.\n' } };
    assertBounced(runShim(world, specced, body), specced, SPEC_BLOCK(7), 'the uncontracted flip');
    const create = ['issue', 'create', '--title', 'review notes from the 0.88 ship', '--body', 'notes'];
    assertBounced(runShim(world, create), create, FINDINGS_BLOCK, 'the review notes create');
  });

  test('case 7: the same unproved flip outside a Claude session runs the real gh, unjudged, and journals nothing', async () => {
    const world = mkGateWorld({ touched: true });
    assertRan(runShim(world, QA_FLIP, { ...NO_PROOF, claude: false }), QA_FLIP, null, 'the flip at the owner\'s terminal');
    expect(journal(world).length, `no journal line, got: ${JSON.stringify(journal(world))}`).toBe(0);
  });

  test('case 8: a write the real gh fails exits 1 and journals nothing; the same write answered journals its line', async () => {
    const world = mkGateWorld();
    const comment = ['api', '-X', 'POST', 'repos/acme/rostered/issues/1/comments', '-f', 'body=x'];
    const failed = runShim(world, comment, { api: {} });
    expect(failed.code, `the stub's 404 is the shim's exit (stderr: ${failed.stderr.trim()})`).toBe(1);
    expect(callsOf(failed, comment).length, `the real gh ran the write, got ${fmtCalls(failed.calls)}`).toBe(1);
    expect(journal(world).length, `a failed write journals nothing, got: ${JSON.stringify(journal(world))}`).toBe(0);

    const answered = { 'POST repos/acme/rostered/issues/1/comments': { status: 201, body: { id: 2001, body: 'x' } } };
    expect(runShim(world, comment, { api: answered }).code, 'the answered write passes').toBe(0);
    const lines = journal(world);
    expect(lines.length, `one line for the answered write, got: ${JSON.stringify(lines)}`).toBe(1);
    expect(lines[0][1], 'its verb').toBe('api');
  });

  test('journal case 12: a journal last written eight days ago keeps its one line, and the shim\'s write lands after it', async () => {
    const world = mkGateWorld();
    const file = journalFile(path.join(world.home, '.workkit'), world.rostered);
    const old = ['1700000000000', 'issue', 'edit', 'acme/rostered', '7', 'status:building', '', gitPath(world.rostered)];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${old.join('\t')}\n`);
    const idle = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(file, idle, idle);

    const comment = ['api', '-X', 'POST', 'repos/acme/rostered/issues/1/comments', '-f', 'body=x'];
    const answered = { 'POST repos/acme/rostered/issues/1/comments': { status: 201, body: { id: 2001, body: 'x' } } };
    expect(runShim(world, comment, { api: answered }).code, 'the answered write passes').toBe(0);
    const lines = journal(world);
    expect(JSON.stringify(lines.map((l) => l[1])), 'the old line\'s verb, then the new one\'s').toBe(JSON.stringify(['issue', 'api']));
    expect(JSON.stringify(lines[0]), 'the old line unchanged').toBe(JSON.stringify(old));
  });

  test('ports proof-guard\'s close cases through the gate: --reason "not planned" and --duplicate-of pass unproved, --reason completed bounces', async () => {
    const world = mkGateWorld();
    for (const argv of [['issue', 'close', '9', '--reason', 'not planned'], ['issue', 'close', '9', '--duplicate-of', '7']]) {
      const res = runShim(world, argv, NO_PROOF);
      expect(res.code, `${argv.join(' ')}: nothing was built, so nothing is proved (stderr: ${res.stderr.trim()})`).toBe(0);
      expect(callsOf(res, argv).length, `${argv.join(' ')}: the real gh ran it, got ${fmtCalls(res.calls)}`).toBe(1);
    }
    const completed = ['issue', 'close', '9', '--reason', 'completed'];
    assertBounced(runShim(world, completed, NO_PROOF), completed, PROOF_BLOCK(9, 'be closed'), 'completed means built');
  });

  test('a close whose issue gh cannot read passes with proof-guard\'s notice on stderr, and the real gh runs it', async () => {
    const world = mkGateWorld();
    const close = ['issue', 'close', '9'];
    const res = runShim(world, close, { field: 'comments', issues: {} });
    expect(res.code, `the close passes (stderr: ${res.stderr.trim()})`).toBe(0);
    expect(res.stderr.includes('proof-guard: could not read issue #9 (gh could not answer), so the proof gate did not run'),
      `stderr carries the notice, got: ${res.stderr}`).toBeTruthy();
    expect(callsOf(res, close).length, `the real gh ran the close, got ${fmtCalls(res.calls)}`).toBe(1);
  });

  test('case 12: an unproved close in a Claude session runs unjudged from a repo not opted in and under HOOK_DISABLE=1, and the leak scan still bounces there', async () => {
    const world = mkGateWorld();
    const close = ['issue', 'close', '9'];
    // A repo with an origin and a .env but no .workkit/settings.json.
    fs.writeFileSync(path.join(world.unrostered, '.env'), `API_SECRET=${SECRET}\n`);
    const unopted = runShim(world, close, { ...NO_PROOF, cwd: world.unrostered });
    assertWrote(unopted, close, null, 'the close from the repo not opted in');
    const lines = journalLines(path.join(world.home, '.workkit'), world.unrostered);
    expect(JSON.stringify(lines.map((l) => l.slice(1, 5))), 'the session still journals the write').toBe(JSON.stringify([['issue', 'close', 'acme/unrostered', '9']]));

    const disabled = runShim(world, close, { ...NO_PROOF, env: { HOOK_DISABLE: '1' } });
    expect(disabled.code, `the close under HOOK_DISABLE=1 passes (stderr: ${disabled.stderr.trim()})`).toBe(0);
    expect(callsOf(disabled, close).length, `the real gh ran it, got ${fmtCalls(disabled.calls)}`).toBe(1);

    const leak = ['issue', 'comment', '9', '--body', `the key is ${SECRET}`];
    assertBounced(runShim(world, leak, { cwd: world.unrostered }), leak, ENV_LEAK, 'the leak from the repo not opted in');
  });
});

describe('identity/gh: a release call', () => {
  test('ship hooks case 9: gh release create in an enabled repo declaring afterRelease runs no hook', async () => {
    const world = mkWorld();
    const settings = path.join(world.rostered, '.workkit', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, `${JSON.stringify({ enabled: true, hooks: { afterRelease: [{ command: 'echo ran >> ran.txt' }] } })}\n`);
    const release = ['release', 'create', 'v1.2.3', '--notes', 'x'];
    for (const [what, opts] of Object.entries({ 'in a Claude session': {}, 'outside a Claude session': { claude: false } })) {
      const res = runRealGh(world, release, opts);
      const said = res.lines.join(' | ');
      expect(res.lines.includes(`real-gh: ${release.join(' ')}`), `${what}: the real gh ran the release, got: ${said}`).toBeTruthy();
      expect(res.lines.includes('code: 0'), `${what}: the call exits the real gh's 0, got: ${said}`).toBeTruthy();
      expect(res.ran, `${what}: no hook ran`).toBe(null);
    }
  });

  test('node shim hand-over: outside a Claude session the caller gets the real gh\'s own non-zero exit and its stdout and stderr unchanged', async () => {
    const world = mkWorld();
    const realGh = path.join(world.root, 'failing-gh');
    fs.mkdirSync(realGh);
    stubToolJs(realGh, 'gh', [
      "process.stdout.write('first line\\nno line end');",
      "process.stderr.write('gh: HTTP 422: Validation Failed\\n');",
      'process.exitCode = 3;',
    ].join('\n'));
    const res = runShim(world, ['issue', 'list'], { claude: false, extraDirs: [realGh] });
    expect(res.code, `the real gh's exit (stderr: ${res.stderr.trim()})`).toBe(3);
    expect(res.stdout, 'the real gh\'s stdout, byte for byte').toBe('first line\nno line end');
    expect(res.stderr, 'the real gh\'s stderr, byte for byte').toBe('gh: HTTP 422: Validation Failed\n');
  });
});

describe('identity/gh: the hand-over to the real gh', () => {
  const BODY = 'first line\nsecond: ünïcode, "quotes" & $dollar `tick`\nno line end';
  const COMMENTS = 'repos/acme/rostered/issues/1/comments';
  const SPELLINGS = [
    ['issue', 'comment', '1', '--body-file', '-'],
    ['issue', 'comment', '1', '-F', '-'],
    ['issue', 'comment', '1', '--body-file=-'],
    ['api', '-X', 'POST', COMMENTS, '--input', '-'],
    ['api', '-X', 'POST', COMMENTS, '-F', 'body=@-'],
  ];

  test('node shim stdin: the real gh reads the body piped in, byte for byte, through every - spelling, in a Claude session and out, a bot call with its token, and no temp copy is left', async () => {
    const world = mkWorld();
    const real = bodyReader(path.join(world.root, 'body-gh'));
    for (const claude of [true, false]) {
      for (const argv of SPELLINGS) {
        const what = `${claude ? 'in a Claude session' : 'outside one'}, gh ${argv.join(' ')}`;
        const tmp = mkTmp('wk-gh-body-tmp-');
        const res = runShim(world, argv, {
          claude, input: BODY, extraDirs: [real.dir], tempDir: tmp,
        });
        expect(res.code, `${what}: the exit (stderr: ${res.stderr.trim()})`).toBe(0);
        const got = real.take();
        expect(got && got.body, `${what}: the body the real gh read`).toBe(BODY);
        const bot = claude && argv[0] === 'issue';
        expect(got.token, `${what}: GH_TOKEN`).toBe(bot ? 'ghs_testtoken' : null);
        expect(heldIn(tmp, 'nïcode').join(', '), `${what}: no file under the temp folder still holds the body`).toBe('');
      }
    }
  });

  test('node shim signal: a TERM to the shim while the real gh runs reaches the real gh', { skip: skipWithoutCaughtSignal() }, async (t) => {
    const world = mkWorld();
    const dir = path.join(world.root, 'term-gh');
    fs.mkdirSync(dir);
    const ready = path.join(dir, 'ready');
    const termed = path.join(dir, 'termed');
    stubToolJs(dir, 'gh', [
      "const fs = require('fs');",
      `process.on('SIGTERM', () => { fs.writeFileSync(${jsPath(termed)}, 'TERM'); process.exit(143); });`,
      `fs.writeFileSync(${jsPath(ready)}, String(process.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const env = homeEnv(world.home, { PATH: systemPathWith(path.dirname(world.shim), dir, NODE_DIR) });
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    const shim = start(world.shim, ['issue', 'list'], { cwd: world.rostered, env });
    t.after(async () => {
      // The real gh outlives a shim that never passed the TERM on; ESRCH means it is gone.
      try { process.kill(Number(fs.readFileSync(ready, 'utf8')), 'SIGKILL'); } catch {}
      await shim.end('SIGKILL');
    });
    expect(await until(() => fs.existsSync(ready) && fs.readFileSync(ready, 'utf8') !== ''), `the real gh started, stderr: ${shim.stderr()}`).toBeTruthy();
    process.kill(shim.child.pid, 'SIGTERM');
    await shim.done;
    expect(await until(() => fs.existsSync(termed)), `the real gh got the TERM, stderr: ${shim.stderr()}`).toBeTruthy();
  });

  test('node shim signal: a TERM while the token step waits, before the real gh runs, ends the shim by the signal and leaves no copy of the stdin body', { skip: skipWithoutCaughtSignal() }, async (t) => {
    // One stand-in is GitHub's API and the token service, and it answers no request,
    // so the token step waits on it for as long as the case holds it.
    const asked = path.join(mkTmp('wk-gh-shim-hold-'), 'asked.log');
    const hold = start(process.execPath, ['-e', [
      "const http = require('http');",
      "const fs = require('fs');",
      'const held = [];',
      `const server = http.createServer((req, res) => { held.push(res); fs.appendFileSync(${jsPath(asked)}, req.method + ' ' + req.url + '\\n'); });`,
      "server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'));",
    ].join('\n')]);
    t.after(() => hold.end('SIGKILL'));
    await until(() => hold.stdout().endsWith('\n') || hold.child.exitCode !== null);
    const url = `http://127.0.0.1:${hold.stdout().trim()}`;

    const world = mkWorld({ cache: false, tokenUrl: `${url}/token` });
    const tmp = mkTmp('wk-gh-shim-hold-tmp-');
    const stub = makeGhStub();
    const env = {
      ...homeEnv(world.home, { PATH: systemPathWith(path.dirname(world.shim), stub.binDir, NODE_DIR), CLAUDECODE: '1' }),
      ...nodeTempEnv(tmp),
      HOME: world.home,
      GITHUB_SERVER_URL: url,
      GITHUB_API_URL: url,
    };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    const body = 'held body: ünïcode\nno line end';
    const shim = start(world.shim, ['issue', 'comment', '1', '--body-file', '-'], { cwd: world.rostered, env, input: body });
    t.after(() => shim.end('SIGKILL'));
    expect(await until(() => fs.existsSync(asked) || shim.child.exitCode !== null), `the token step asked the stand-in, stderr: ${shim.stderr()}`).toBeTruthy();
    expect(shim.child.exitCode, `the shim still waits on the token step, stderr: ${shim.stderr()}`).toBe(null);
    process.kill(shim.child.pid, 'SIGTERM');
    const done = await shim.done;
    expect(done.signal, `the shim ended by the TERM, got status ${done.status}, stderr: ${shim.stderr()}`).toBe('SIGTERM');
    expect(heldIn(tmp, 'nïcode').join(', '), 'no file under the temp folder still holds the stdin body').toBe('');
    expect(ghCalls(stub).length, `the real gh never ran, got ${fmtCalls(ghCalls(stub))}`).toBe(0);
  });
});
