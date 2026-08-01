//
// Tests for tower/api/server.js — the endpoints, the caches, the one write path.
//
// The WHOLE server runs here, on port 0, against fixtures: a scratch ~/.workkit
// whose roster lists one real git repo, a scratch marker directory and
// statusline cache, and one fake exec standing in for `gh` and `ps` (`git` is
// answered for real, because the roster and health both ask git questions no
// stub could answer honestly).
//
// The intake endpoint is exercised for its ARGV, never for its effect: the fake
// exec records the exact argument vector and returns what `gh issue create`
// prints. Nothing in this file can file an issue anywhere.
//

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const {
  createServer, DEFAULT_BIND, DEFAULT_PORT, MAX_REQUEST_BYTES, MOVE_STATUSES,
} = require(path.join(__dirname, '..', '..', 'tower', 'api', 'server.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-server-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const SLUG = 'ITW-Creative-Works/fixture';

const issueNode = (number, labels) => ({
  number,
  title: `issue ${number}`,
  url: `https://github.com/${SLUG}/issues/${number}`,
  updatedAt: '2026-07-27T00:00:00Z',
  labels: { nodes: labels.map((name) => ({ name })) },
  assignees: { nodes: [] },
});

/**
 * A scratch world: one opted-in git repo with an origin, registered in the
 * scratch ~/.workkit the server reads as its roster, one live keep-awake marker
 * with its transcript, a statusline cache entry, and the exec seam that answers
 * gh and ps while passing git through to the real binary.
 */
const mkWorld = () => {
  const root = mkTmp();
  const repo = path.join(root, 'repos', 'Owner', 'fixture');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'remote', 'add', 'origin', `git@github.com:${SLUG}.git`);
  fs.mkdirSync(path.join(repo, '.workkit'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), JSON.stringify({ version: 7, enabled: true }));
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- [#1](u) — One thing.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'initial');

  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(workflowHome, { recursive: true });
  fs.writeFileSync(
    path.join(workflowHome, '.repos.json'),
    JSON.stringify({ version: 1, repos: { [repo]: 'enabled' } }, null, 2),
  );

  const markerDir = path.join(root, 'claude-keep-awake');
  const stateDir = path.join(root, 'claude-session-state');
  const home = path.join(root, 'home');
  fs.mkdirSync(markerDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, '5001'), 'caffeinate=6001\ncwd=/x/fixture\nsession=sess-1\n');
  const transcript = path.join(home, '.claude', 'projects', '-x-fixture', 'sess-1.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '{"customTitle":"The tower build"}\n');
  fs.writeFileSync(path.join(stateDir, 'sess_1.json'), JSON.stringify({
    model: { id: 'claude-opus-5' },
    effort: { level: 'high' },
  }));

  const world = {
    root,
    repo,
    markerDir,
    stateDir,
    home,
    calls: [],
    // What `gh api graphql` answers. Replaceable per test.
    board: {
      data: { r0: { issues: { totalCount: 2, nodes: [issueNode(17, ['status:specced', 'agent:ok']), issueNode(18, ['status:blocked', 'priority:high'])] } } },
    },
    // What `gh issue create` does. Either a string to print or an Error to throw.
    createResult: `https://github.com/${SLUG}/issues/99\n`,
    // And what `gh issue edit` does — the relabel the board's drag performs.
    editResult: `https://github.com/${SLUG}/issues/17\n`,
    // Flip to make the `gh --version` probe fail, as an unprovisioned machine does.
    ghMissing: false,
  };

  world.exec = (cmd, args) => {
    world.calls.push([cmd, ...args]);
    if (cmd === 'git') return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (cmd === 'ps') return 'caffeinate -d -i -w 5001\n';
    if (cmd === 'gh' && args[0] === '--version') {
      if (world.ghMissing) throw new Error('spawnSync gh ENOENT');
      return 'gh version 2.0.0\n';
    }
    if (cmd === 'gh' && args[0] === 'api') return JSON.stringify(world.board);
    if (cmd === 'gh' && args[0] === 'issue') {
      const result = args[1] === 'edit' ? world.editResult : world.createResult;
      if (result instanceof Error) throw result;
      return result;
    }
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  return world;
};

/** Listen on port 0 and hand back a client bound to whatever port that was. */
const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const { address, port } = server.address();
    resolve({
      server,
      address,
      port,
      url: (p) => `http://127.0.0.1:${port}${p}`,
      stop: () => new Promise((done) => server.close(done)),
    });
  });
});

/** The server options for a world — a live object, so a test may mutate it. */
const worldOpts = (world, opts = {}) => ({
  workflowHome: path.join(world.root, 'workflow-home'),
  markerDir: world.markerDir,
  stateDir: world.stateDir,
  home: world.home,
  exec: world.exec,
  ...opts,
});

/** Start the server on port 0 against a world; returns a client bound to it. */
const start = (world, opts = {}) => listen(createServer(worldOpts(world, opts)));

const getJson = async (client, p) => {
  const res = await fetch(client.url(p));
  return { status: res.status, body: await res.json() };
};

const postJson = async (client, p, payload) => {
  const res = await fetch(client.url(p), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

/**
 * A request built by hand. `fetch` will not let a caller set Host, and Host is
 * exactly what the allowlist judges — so the header cases speak http directly.
 */
const raw = (client, { method = 'GET', path: p = '/', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: client.port, method, path: p, headers }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
  });
  // An over-cap POST is answered mid-upload and the connection then closed, so
  // the write end may error AFTER the response arrived. The promise is already
  // settled by then; a late rejection is a no-op.
  req.on('error', reject);
  if (body !== null) req.write(body);
  req.end();
});

const ghCalls = (world, verb) => world.calls.filter((c) => c[0] === 'gh' && c[1] === verb);

/** The repo tiles in a /api/health payload — everything that is not the meta block. */
const tiles = (body) => Object.keys(body).filter((key) => key !== 'meta');

/**
 * Answer `git rev-parse HEAD` from a script instead of the real checkout: the
 * first entry is what the boot capture sees, the last what every live read
 * after it sees. An Error is thrown, which is git being absent or the checkout
 * not being a repository. Everything else falls through to the world's seam.
 */
const scriptHead = (world, answers) => {
  const inner = world.exec;
  const queue = answers.slice();
  world.exec = (cmd, args) => {
    if (cmd === 'git' && args.includes('rev-parse') && args.includes('HEAD')) {
      world.calls.push([cmd, ...args]);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return `${next}\n`;
    }
    return inner(cmd, args);
  };
};

const run = async () => {
  group('tower/api/server: the read endpoints');

  await test('/api/repos serves the discovered roster', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/repos');
    assertEq(status, 200, 'ok');
    assertEq(body.length, 1, 'one repo in the fixture root');
    assertEq(body[0].slug, SLUG, 'with its origin slug');
    assertEq(body[0].path, w.repo, 'and its path');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief assembles the morning from the same board and health', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/brief');
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'the sweep behind it succeeded');
    // The fixture board is one specced issue and one blocked one.
    assertEq(body.counts.waiting, 1, 'the blocked issue is waiting on a human');
    assertEq(body.waiting[0].number, 18, 'and it is named');
    assertEq(body.counts.ready, 1, 'the specced issue is unclaimed, so it is ready');
    assert(/waiting on a decision/.test(body.headline), 'the headline leads with the decision');
    // The fixture repo has an unreleased CHANGELOG entry and no tag.
    assertEq(body.warnings.length, 1, 'the repo has work sitting on the table');
    assertEq(body.warnings[0].repo, SLUG, 'named by its slug');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/board serves the sweep, normalized', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/board');
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'the sweep succeeded');
    assertEq(body.issues.length, 2, 'both issues');
    assertEq(body.issues[0].status, 'specced', 'labels parsed');
    assertEq(body.issues[0].agentOk, true, 'the runway badge');
    assertEq(body.issues[1].priority, 'high', 'priority parsed');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/sessions serves the live crew', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/sessions');
    assertEq(status, 200, 'ok');
    assertEq(body.length, 1, 'one marker');
    assertEq(body[0].claudePid, 5001, 'the pid from the marker name');
    assertEq(body[0].chatName, 'The tower build', 'the transcript title');
    assertEq(body[0].state, 'working', 'fresh transcript, live assertion');
    assertEq(body[0].model, 'claude-opus-5', 'from the statusline cache');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/health is keyed by repo path and carries the CHANGELOG count', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/health');
    assertEq(status, 200, 'ok');
    assertEq(tiles(body).length, 1, 'one tile');
    const health = body[w.repo];
    assertEq(health.unreleasedEntries, 1, 'one [Unreleased] bullet');
    assertEq(health.uncommitted, 0, 'a clean fixture');
    assertEq(health.unpushed, null, 'no upstream is null, not zero');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/health carries a meta block naming the process that is answering', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { body } = await getJson(c, '/api/health');
    assert(body.meta && typeof body.meta === 'object', 'the payload carries a meta block');
    assert(/^[0-9a-f]{40}$/.test(body.meta.bootCommit), 'the commit the process booted from');
    assertEq(body.meta.currentHead, body.meta.bootCommit, 'and the checkout is at that same commit');
    assert(!Number.isNaN(new Date(body.meta.startedAt).getTime()), 'with a readable start time');
    assertEq(tiles(body).length, 1, 'beside the per-repo map, which is untouched');
    await c.stop();
    cleanup(w.root);
  });

  await test('a process older than its checkout shows the two commits differing', async () => {
    const w = mkWorld();
    // The #64 shape: the tower was started before the code on disk existed.
    scriptHead(w, ['a'.repeat(40), 'b'.repeat(40)]);
    const c = await start(w);
    const { body } = await getJson(c, '/api/health');
    assertEq(body.meta.bootCommit, 'a'.repeat(40), 'the boot capture is the OLD commit');
    assertEq(body.meta.currentHead, 'b'.repeat(40), 'and the live read is what is on disk now');
    assert(body.meta.bootCommit !== body.meta.currentHead, 'which is the staleness the page reads');
    await c.stop();
    cleanup(w.root);
  });

  await test('git failing answers two nulls — absence of proof is not staleness', async () => {
    const w = mkWorld();
    scriptHead(w, [new Error('spawnSync git ENOENT')]);
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/health');
    assertEq(status, 200, 'the endpoint still answers');
    assertEq(body.meta.bootCommit, null, 'nothing was captured at boot');
    assertEq(body.meta.currentHead, null, 'and nothing can be read now');
    assertEq(tiles(body).length, 1, 'the readings are unaffected');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: caching');

  await test('two board reads inside the TTL make ONE graphql call', async () => {
    const w = mkWorld();
    const c = await start(w);
    await getJson(c, '/api/board');
    await getJson(c, '/api/board');
    assertEq(ghCalls(w, 'api').length, 1, 'the second read was served from memory');
    await c.stop();
    cleanup(w.root);
  });

  await test('the roster cache means the board and health share one disk walk', async () => {
    const w = mkWorld();
    const c = await start(w);
    await getJson(c, '/api/repos');
    await getJson(c, '/api/board');
    await getJson(c, '/api/health');
    const remotes = w.calls.filter((c2) => c2[0] === 'git' && c2.includes('get-url'));
    assertEq(remotes.length, 1, 'discovery ran once for all three endpoints');
    await c.stop();
    cleanup(w.root);
  });

  await test('a failed sweep is NOT cached — the next read inside the TTL tries again', async () => {
    const w = mkWorld();
    w.ghMissing = true;
    const c = await start(w);
    const first = await getJson(c, '/api/board');
    assertEq(first.body.ok, false, 'the failure is served');
    w.ghMissing = false;
    const second = await getJson(c, '/api/board');
    assertEq(second.body.ok, true, 'the recovery is immediate, not a minute away');
    assertEq(second.body.issues.length, 2, 'and it carries the real data');
    await c.stop();
    cleanup(w.root);
  });

  await test('a failed roster read is not cached either, and still serves [] meanwhile', async () => {
    const w = mkWorld();
    // A workflow home that is not a path makes the read throw — the "read
    // failed" case, which must not take the cache slot the way a genuinely
    // empty roster does.
    const opts = worldOpts(w, { workflowHome: 42 });
    const c = await listen(createServer(opts));
    const broken = await getJson(c, '/api/repos');
    assertEq(broken.status, 200, 'the client is never handed an error page');
    assertEq(broken.body.length, 0, 'an empty roster is what it sees');
    opts.workflowHome = path.join(w.root, 'workflow-home');
    const fixed = await getJson(c, '/api/repos');
    assertEq(fixed.body.length, 1, 'the repaired roster is read at once');
    await c.stop();
    cleanup(w.root);
  });

  await test('an empty roster IS cached — nothing found is an answer', async () => {
    const w = mkWorld();
    const c = await start(w, { workflowHome: path.join(w.root, 'empty') });
    fs.mkdirSync(path.join(w.root, 'empty'), { recursive: true });
    await getJson(c, '/api/repos');
    const before = w.calls.length;
    await getJson(c, '/api/repos');
    assertEq(w.calls.length, before, 'the second read asked git nothing');
    await c.stop();
    cleanup(w.root);
  });

  await test('?fresh=1 bypasses and repopulates the cache — the refresh button works', async () => {
    const w = mkWorld();
    const c = await start(w);
    await getJson(c, '/api/board');
    await getJson(c, '/api/board');
    assertEq(ghCalls(w, 'api').length, 1, 'cached so far');
    await getJson(c, '/api/board?fresh=1');
    assertEq(ghCalls(w, 'api').length, 2, 'the forced read went out');
    await getJson(c, '/api/board');
    assertEq(ghCalls(w, 'api').length, 2, 'and it repopulated the slot');

    const walks = () => w.calls.filter((call) => call[0] === 'git' && call.includes('get-url')).length;
    const before = walks();
    await getJson(c, '/api/repos?fresh=1');
    assertEq(walks(), before + 1, 'the roster takes the same flag');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: intake, the filing write path');

  await test('a valid filing calls gh with exactly the expected ARGV and returns the url', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG, title: '  Watch the tower  ', body: 'From the phone.' });
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'filed');
    assertEq(body.url, `https://github.com/${SLUG}/issues/99`, 'the url gh printed');
    const [call] = ghCalls(w, 'issue');
    assertEq(call.join(' '),
      `gh issue create --repo ${SLUG} --title Watch the tower --body From the phone. --label status:inbox --label type:idea`,
      'ARGV, not a shell string — title trimmed, both labels present');
    await c.stop();
    cleanup(w.root);
  });

  await test('an omitted body files the default text', async () => {
    const w = mkWorld();
    const c = await start(w);
    await postJson(c, '/api/intake', { repo: SLUG, title: 'No body' });
    const [call] = ghCalls(w, 'issue');
    assertEq(call[call.indexOf('--body') + 1], 'Filed from the tower.', 'the default body');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo outside the roster is rejected without ever calling gh', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, '/api/intake', { repo: 'someone/else', title: 'Nope' });
    assertEq(status, 400, 'rejected');
    assertEq(body.ok, false, 'not filed');
    assert(/unknown repo/.test(body.reason), 'the reason names it');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran against an arbitrary string');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo named in another case is accepted, and gh gets the roster’s spelling', async () => {
    const w = mkWorld();
    const c = await start(w);
    // GitHub treats owner and repo names as case-insensitive, and the roster's
    // slug is whatever case the git remote carries — so a payload written in
    // GitHub's canonical casing names the same repository.
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG.toUpperCase(), title: 'Shouted' });
    assertEq(status, 200, 'accepted');
    assertEq(body.ok, true, 'filed');
    const [call] = ghCalls(w, 'issue');
    assertEq(call[call.indexOf('--repo') + 1], SLUG, 'gh receives the roster spelling, not the caller’s');
    await c.stop();
    cleanup(w.root);
  });

  await test('an empty title and an over-long one are both rejected, gh untouched', async () => {
    const w = mkWorld();
    const c = await start(w);
    const empty = await postJson(c, '/api/intake', { repo: SLUG, title: '   ' });
    assertEq(empty.body.ok, false, 'empty title out');
    assert(/title is required/.test(empty.body.reason), 'says why');
    const long = await postJson(c, '/api/intake', { repo: SLUG, title: 'x'.repeat(257) });
    assertEq(long.body.ok, false, '257 characters out');
    assert(/longer than 256/.test(long.body.reason), 'names the cap');
    const big = await postJson(c, '/api/intake', { repo: SLUG, title: 'fine', body: 'y'.repeat(4001) });
    assertEq(big.body.ok, false, 'an over-long body out');
    assert(/longer than 4000/.test(big.body.reason), 'names that cap too');
    assertEq(ghCalls(w, 'issue').length, 0, 'no filing attempted');
    await c.stop();
    cleanup(w.root);
  });

  await test('a gh failure is a soft-fail body, never a 500', async () => {
    const w = mkWorld();
    const err = new Error('Command failed: gh issue create');
    err.stderr = 'gh: To get started with GitHub CLI, please run: gh auth login\n';
    w.createResult = err;
    const c = await start(w);
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG, title: 'Offline' });
    assertEq(status, 200, 'the tower stays up');
    assertEq(body.ok, false, 'not filed');
    assert(/gh auth login/.test(body.reason), 'the underlying message survives');
    await c.stop();
    cleanup(w.root);
  });

  await test('gh output carrying no url reads as a failure, not a success', async () => {
    const w = mkWorld();
    w.createResult = 'Creating issue in ...\n';
    const c = await start(w);
    const { body } = await postJson(c, '/api/intake', { repo: SLUG, title: 'Silent' });
    assertEq(body.ok, false, 'no url, no claim of success');
    await c.stop();
    cleanup(w.root);
  });

  await test('an over-cap body gets its answer before the connection closes', async () => {
    const w = mkWorld();
    const c = await start(w);
    const body = JSON.stringify({ repo: SLUG, title: 'huge', body: 'z'.repeat(MAX_REQUEST_BYTES + 1024) });
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body,
    });
    assertEq(res.status, 413, 'the client is TOLD, not just disconnected');
    assert(/larger than/.test(res.text), 'and told why');
    assertEq(ghCalls(w, 'issue').length, 0, 'nothing was filed');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: the board’s relabel write path');

  const MOVE = '/api/issues/status';
  const validMove = { repo: SLUG, number: 17, from: 'specced', to: 'blocked' };

  await test('a valid move calls gh with exactly the expected ARGV and reports the new status', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, validMove);
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'moved');
    assertEq(body.status, 'blocked', 'the status it now carries');
    assertEq(body.number, 17, 'on the issue that was dragged');
    const [call] = ghCalls(w, 'issue');
    assertEq(call.join(' '),
      `gh issue edit 17 --repo ${SLUG} --remove-label status:specced --add-label status:blocked`,
      'ARGV, not a shell string — and both halves of the move in ONE call, so the issue never carries two statuses');
    await c.stop();
    cleanup(w.root);
  });

  await test('the vocabulary is the label SSOT’s own five, never a second copy', () => {
    assertEq(MOVE_STATUSES.join(','), 'inbox,specced,building,blocked,parked', 'the pipeline, in its own order');
  });

  await test('a move into status:building is a valid move — in-flight work is a column like any other', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, to: 'building' });
    assertEq(status, 200, 'ok');
    assertEq(body.status, 'building', 'the status it now carries');
    const [call] = ghCalls(w, 'issue');
    assertEq(call.join(' '),
      `gh issue edit 17 --repo ${SLUG} --remove-label status:specced --add-label status:building`,
      'the flip that starts the work is one call, like every other move');
    await c.stop();
    cleanup(w.root);
  });

  await test('a move out of status:building is valid too — the board can pull work back', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'building', to: 'blocked' });
    assertEq(status, 200, 'ok');
    assertEq(body.status, 'blocked', 'a question mid-build is still a question');
    await c.stop();
    cleanup(w.root);
  });

  await test('an issue number that is not a positive integer is refused, gh untouched', async () => {
    const w = mkWorld();
    const c = await start(w);
    for (const number of [0, -3, 2.5, '17', null, undefined]) {
      const { status, body } = await postJson(c, MOVE, { ...validMove, number });
      assertEq(status, 400, `${JSON.stringify(number)} is rejected`);
      assert(/positive integer/.test(body.reason), 'and the reason says what one is');
    }
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran against any of them');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo that is not shaped like a slug never reaches the roster comparison', async () => {
    const w = mkWorld();
    const c = await start(w);
    for (const repo of ['', 'nope', 'owner/name/extra', 'owner/name;rm -rf /', '../../etc/passwd', 42]) {
      const { status, body } = await postJson(c, MOVE, { ...validMove, repo });
      assertEq(status, 400, `${JSON.stringify(repo)} is rejected`);
      assert(/not a repository slug/.test(body.reason), 'on its shape alone');
    }
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('a well-formed slug the roster does not hold is refused too', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, repo: 'someone/else' });
    assertEq(status, 400, 'the shape test is the first gate, not the only one');
    assert(/unknown repo/.test(body.reason), 'the roster is what a repo is judged against');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran against an arbitrary repository');
    await c.stop();
    cleanup(w.root);
  });

  await test('a status outside the vocabulary is refused at either end', async () => {
    const w = mkWorld();
    const c = await start(w);
    const bad = await postJson(c, MOVE, { ...validMove, to: 'shipped' });
    assertEq(bad.status, 400, 'an invented status is not one');
    assert(/to is not a status/.test(bad.body.reason), 'and the end it was on is named');
    const worse = await postJson(c, MOVE, { ...validMove, from: '' });
    assertEq(worse.status, 400, 'and neither is none at all — the No-status column is not a move');
    assert(/from is not a status/.test(worse.body.reason), 'named too');
    const label = await postJson(c, MOVE, { ...validMove, to: 'status:parked' });
    assertEq(label.status, 400, 'the value is a status, not a whole label');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('a drop on the column the card came from is refused rather than run', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, to: 'specced' });
    assertEq(status, 400, 'nothing to change');
    assert(/already status:specced/.test(body.reason), 'and it says so');
    assertEq(ghCalls(w, 'issue').length, 0, 'a no-op never becomes a write');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo named in another case is accepted, and gh gets the roster’s spelling', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status } = await postJson(c, MOVE, { ...validMove, repo: SLUG.toUpperCase() });
    assertEq(status, 200, 'GitHub names are case-insensitive');
    const [call] = ghCalls(w, 'issue');
    assertEq(call[call.indexOf('--repo') + 1], SLUG, 'gh receives the roster spelling, not the caller’s');
    await c.stop();
    cleanup(w.root);
  });

  await test('a gh failure is a soft-fail body the page can revert on, never a 500', async () => {
    const w = mkWorld();
    const err = new Error('Command failed: gh issue edit');
    err.stderr = 'gh: could not add label: not found\n';
    w.editResult = err;
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, validMove);
    assertEq(status, 200, 'the tower stays up');
    assertEq(body.ok, false, 'not moved');
    assert(/could not add label/.test(body.reason), 'the underlying message survives');
    await c.stop();
    cleanup(w.root);
  });

  await test('the preflight covers this POST too — one answer, both write paths', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'OPTIONS',
      path: MOVE,
      headers: {
        host: `127.0.0.1:${c.port}`,
        origin: 'https://localhost:4300',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assertEq(res.status, 204, 'answered, not 405');
    assert(/POST/.test(res.headers['access-control-allow-methods']), 'the write method is allowed');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'for the dashboard origin');

    const wrote = await raw(c, {
      method: 'POST',
      path: MOVE,
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://localhost:4300', 'content-type': 'application/json' },
      body: JSON.stringify(validMove),
    });
    assertEq(wrote.status, 200, 'and the POST that follows it lands');
    assertEq(wrote.headers['access-control-allow-origin'], 'https://localhost:4300', 'readable to the page');
    await c.stop();
    cleanup(w.root);
  });

  await test('an off-list Origin cannot move an issue', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'POST',
      path: MOVE,
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(validMove),
    });
    assertEq(res.status, 403, 'the same gate the read paths and intake pass');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('a body that is not a JSON object is refused before anything is read out of it', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, 'just a string');
    assertEq(status, 400, 'rejected');
    assert(/JSON object/.test(body.reason), 'says what a body is');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('the endpoint is a write and nothing else — a GET of it is a 404', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status } = await getJson(c, MOVE);
    assertEq(status, 404, 'there is no such read endpoint');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: who may reach the tower');

  await test('a Host the tower does not answer to is 403, on a plain read', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, { path: '/api/repos', headers: { host: 'evil.example.com' } });
    assertEq(res.status, 403, 'a page that resolved its own name here gets nothing');
    assert(/host not allowed/.test(res.text), 'the reason names it');
    const ok = await raw(c, { path: '/api/repos', headers: { host: `localhost:${c.port}` } });
    assertEq(ok.status, 200, 'localhost is on the list, port and all');
    // The IPv6 loopback arrives bracketed — the allowlist must survive its own
    // URL-parse normalization (a bare ::1 in the constant silently drops out).
    const six = await raw(c, { path: '/api/repos', headers: { host: `[::1]:${c.port}` } });
    assertEq(six.status, 200, 'the IPv6 loopback is local too');
    await c.stop();
    cleanup(w.root);
  });

  await test('a Host or Origin carrying userinfo is refused, not parsed down to its tail', async () => {
    const w = mkWorld();
    const c = await start(w);
    // URL parsing reads everything before an `@` as userinfo and drops it, so
    // `evil.com@localhost` would answer `localhost` and pass an allowlist that
    // has never heard of evil.com. Neither header has a userinfo component.
    const host = await raw(c, { path: '/api/repos', headers: { host: 'evil.com@localhost' } });
    assertEq(host.status, 403, 'the Host gate is not walked through');
    assert(!/"slug"/.test(host.text), 'and no roster leaked');

    const origin = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'http://evil.com@localhost' },
    });
    assertEq(origin.status, 403, 'the Origin gate is not either');
    assertEq(origin.headers['access-control-allow-origin'], undefined, 'and nothing is echoed back');
    await c.stop();
    cleanup(w.root);
  });

  await test('a preflight carrying no Origin is not a browser asking, and is refused', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}` },
    });
    assertEq(res.status, 405, 'it falls through to the method check like any other verb');
    assertEq(res.headers['access-control-allow-methods'], undefined, 'no preflight answer');
    await c.stop();
    cleanup(w.root);
  });

  await test('a tailnet hostname passes once it is in the allowlist, by opt or by env', async () => {
    const w = mkWorld();
    const c = await start(w, { allowHosts: ['tower.tailnet.ts.net'] });
    const res = await raw(c, { path: '/api/repos', headers: { host: 'tower.tailnet.ts.net' } });
    assertEq(res.status, 200, 'tailscale serve fronts the tower under its own name');
    await c.stop();

    const before = process.env.TOWER_ALLOW_HOST;
    try {
      process.env.TOWER_ALLOW_HOST = 'mac.tailnet.ts.net, other.example';
      const env = await start(w);
      const viaEnv = await raw(env, { path: '/api/repos', headers: { host: 'mac.tailnet.ts.net' } });
      assertEq(viaEnv.status, 200, 'TOWER_ALLOW_HOST is the deployment knob');
      const off = await raw(env, { path: '/api/repos', headers: { host: 'nope.example' } });
      assertEq(off.status, 403, 'and it extends the list rather than opening it');
      await env.stop();
    } finally {
      if (before === undefined) delete process.env.TOWER_ALLOW_HOST;
      else process.env.TOWER_ALLOW_HOST = before;
    }
    cleanup(w.root);
  });

  await test('the write path rejects an off-list Origin without calling gh', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'Cross-site' }),
    });
    assertEq(res.status, 403, 'refused');
    assert(/origin not allowed/.test(res.text), 'the reason names it');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('the page’s own Origin passes, and an absent Origin passes too', async () => {
    const w = mkWorld();
    const c = await start(w);
    const same = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: `http://127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'From the page' }),
    });
    assertEq(same.status, 200, 'a browser sends Origin on a same-origin POST');
    assert(/"ok":true/.test(same.text), 'filed');

    const curl = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'From curl' }),
    });
    assertEq(curl.status, 200, 'no Origin at all is a non-browser client');
    assertEq(ghCalls(w, 'issue').length, 2, 'both filings went through');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: CORS for the dashboard origin');

  await test('an allowed origin gets the header echoed back, never a star', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://localhost:4300' },
    });
    assertEq(res.status, 200, 'the dashboard reads the board');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'echoed, so the browser keeps the body');
    assertEq(res.headers.vary, 'Origin', 'and a shared cache cannot mix two origins up');
    assert(/"slug"/.test(res.text), 'the body is the real answer');
    await c.stop();
    cleanup(w.root);
  });

  await test('an off-list origin gets neither the header nor the data', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com' },
    });
    assertEq(res.status, 403, 'refused outright');
    assertEq(res.headers['access-control-allow-origin'], undefined, 'no header');
    assert(!/"slug"/.test(res.text), 'and no board in the body');
    await c.stop();
    cleanup(w.root);
  });

  await test('the intake preflight answers with the methods, headers and a max-age', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: {
        host: `127.0.0.1:${c.port}`,
        origin: 'https://localhost:4300',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assertEq(res.status, 204, 'answered, not 405');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'for this origin');
    assert(/POST/.test(res.headers['access-control-allow-methods']), 'the write method is allowed');
    assert(/content-type/.test(res.headers['access-control-allow-headers']), 'and the JSON content type');
    assert(Number(res.headers['access-control-max-age']) > 0, 'cached, so every filing is not two round trips');
    await c.stop();
    cleanup(w.root);
  });

  await test('a preflight from an off-list origin is refused', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    });
    assertEq(res.status, 403, 'the preflight is judged by the same allowlist');
    assertEq(res.headers['access-control-allow-origin'], undefined, 'and says nothing else');
    await c.stop();
    cleanup(w.root);
  });

  await test('the cross-origin POST that follows the preflight files the issue', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: {
        host: `127.0.0.1:${c.port}`,
        origin: 'https://localhost:4300',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ repo: SLUG, title: 'From the dashboard' }),
    });
    assertEq(res.status, 200, 'filed');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'and the answer is readable to the page');
    assertEq(ghCalls(w, 'issue').length, 1, 'gh ran once');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: the edges');

  await test('the API serves no pages — / is a 404 like any other non-endpoint', async () => {
    const w = mkWorld();
    const c = await start(w);
    const root = await getJson(c, '/');
    assertEq(root.status, 404, 'the dashboard is the OMEGA app, not this process');
    assertEq(root.body.ok, false, 'the soft shape everywhere');
    const asset = await getJson(c, '/assets/css/omega.css');
    assertEq(asset.status, 404, 'and nothing static is served either');
    await c.stop();
    cleanup(w.root);
  });

  await test('an unknown path is a 404 with a JSON reason', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/nope');
    assertEq(status, 404, '404');
    assertEq(body.ok, false, 'the soft shape everywhere');
    assert(/no such endpoint/.test(body.reason), 'says what was asked for');
    await c.stop();
    cleanup(w.root);
  });

  await test('the defaults bind 127.0.0.1 on 8693 — Tailscale is the only way in', () => {
    assertEq(DEFAULT_BIND, '127.0.0.1', 'localhost only, never 0.0.0.0');
    assertEq(DEFAULT_PORT, 8693, 'TOWER on a keypad');
  });

  await test('an absent roster serves an empty one instead of crashing', async () => {
    const w = mkWorld();
    const c = await start(w, { workflowHome: path.join(w.root, 'absent') });
    const repos = await getJson(c, '/api/repos');
    assertEq(repos.body.length, 0, 'empty');
    const health = await getJson(c, '/api/health');
    assertEq(tiles(health.body).length, 0, 'no tiles, no error page');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
