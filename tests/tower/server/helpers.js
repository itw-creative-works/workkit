//
// The shared prologue of the tower/api/server suites, the `*.test.js` files
// beside this one, which test tower/api/server.js: the endpoints, the caches,
// the one write path. A plain module, never a suite: the runner only loads
// files ending in `.test.js`.
//
// The WHOLE server runs in those suites, on port 0, against fixtures: a scratch
// ~/.workkit whose roster lists one real git repo, a scratch marker directory
// and statusline cache, and one fake exec standing in for `gh` and `ps` (`git`
// is answered for real, because the roster and health both ask git questions
// no stub could answer honestly).
//
// The intake endpoint is exercised for its ARGV, never for its effect: the fake
// exec records the exact argument vector and returns what `gh issue create`
// prints. Nothing in these suites can file an issue anywhere.
//

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { resetIn, mkLimited } = require('../../lib/gh');
const { gitPath } = require('../../lib/platform');

const {
  createServer, DEFAULT_BIND, DEFAULT_PORT, MAX_REQUEST_BYTES, MOVE_STATUSES,
} = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'server.js'));

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
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- [#1](u) - One thing.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'initial');

  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(workflowHome, { recursive: true });
  fs.writeFileSync(
    path.join(workflowHome, '.repos.json'),
    JSON.stringify({ version: 1, repos: { [gitPath(repo)]: 'enabled' } }, null, 2),
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
    // What the home repo's Discussions carry - where the summaries are published.
    // Empty is a machine whose board has nothing on it yet.
    discussions: [],
    // What `gh issue create` does. Either a string to print or an Error to throw.
    createResult: `https://github.com/${SLUG}/issues/99\n`,
    // And what `gh issue edit` does - the relabel the board's drag performs.
    editResult: `https://github.com/${SLUG}/issues/17\n`,
    // What `gh issue view --json comments` answers - the proof read a move to
    // Complete makes. Proved by default, so a test that is about anything else
    // is not about the gate.
    viewResult: JSON.stringify({ comments: [{ body: 'Proof:\n- unit: node tests/tower/server.test.js' }] }),
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
    if (cmd === 'gh' && args[0] === 'api') {
      // The board sweep and the home repo's summaries are both `gh api graphql`;
      // the query is what tells them apart.
      if (args.join(' ').includes('discussions(first')) {
        return JSON.stringify({ data: { repository: { discussions: { nodes: world.discussions } } } });
      }
      return JSON.stringify(world.board);
    }
    if (cmd === 'gh' && args[0] === 'issue') {
      const answers = { edit: world.editResult, view: world.viewResult };
      const result = args[1] in answers ? answers[args[1]] : world.createResult;
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

/** The server options for a world - a live object, so a test may mutate it. */
/**
 * Block this thread for `ms`, the way a real `gh api graphql` call does: the
 * sweep runs on execFileSync, so a round holds the event loop for as long as
 * the request takes and nothing else is served during one. A fixture that
 * answered instantly could not hold a sweep in flight long enough for a second
 * request to arrive mid-sweep, which is the state these tests are about.
 */
const blockFor = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** The three pages the fixture board arrives in, one issue to a page. */
const BOARD_PAGES = [[17, ['status:specced']], [18, ['status:qa']], [19, ['status:inbox']]];

/**
 * Make a world's board arrive in THREE pages: issue 17, then 18 and 19 behind
 * the cursors each page ends on. What a repo past GitHub's hundred-issue page
 * looks like to the sweep (issue #194), in three issues instead of three
 * hundred - and the only fixture where a board still arriving and a finished
 * one are told apart.
 *
 * Three rather than two because a sweep has to still be RUNNING when the next
 * request is served: with two pages the one continuation is the end of it.
 * `pause` is what makes that deterministic - a round that holds the loop for
 * long enough that a request sent while it runs is certainly waiting when it
 * ends, and is served with a round still to go.
 */
const pageTheBoard = (world, { pause = 0 } = {}) => {
  const plain = world.exec;
  world.exec = (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'api' && !args.join(' ').includes('discussions(first')) {
      world.calls.push([cmd, ...args]);
      const query = args[args.length - 1];
      const at = BOARD_PAGES.findIndex((_, i) => query.includes(`after: "CUR${i}"`));
      const page = at === -1 ? 0 : at;
      if (page > 0 && pause) blockFor(pause);
      const last = page === BOARD_PAGES.length - 1;
      return JSON.stringify({
        data: {
          r0: {
            issues: {
              totalCount: BOARD_PAGES.length,
              pageInfo: { hasNextPage: !last, endCursor: last ? null : `CUR${page + 1}` },
              nodes: [issueNode(...BOARD_PAGES[page])],
            },
          },
        },
      });
    }
    return plain(cmd, args);
  };
  return world;
};

/**
 * Answer every Discussions read with the live GraphQL rate limit (issue #216),
 * the shape tests/lib/gh.js owns. The board sweep is left alone: a brief whose
 * sweep failed is a different page.
 */
const limitDiscussions = (world) => {
  const inner = world.exec;
  const limited = mkLimited(resetIn(9));
  world.exec = (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'api' && args.join(' ').includes('discussions(first')) {
      world.calls.push([cmd, ...args]);
      return limited();
    }
    return inner(cmd, args);
  };
  return world;
};

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
 * exactly what the allowlist judges - so the header cases speak http directly.
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

/** The repo tiles in a /api/health payload - everything that is not the meta block. */
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

module.exports = {
  createServer, DEFAULT_BIND, DEFAULT_PORT, MAX_REQUEST_BYTES, MOVE_STATUSES,
  cleanup, SLUG, issueNode, mkWorld, BOARD_PAGES, pageTheBoard, limitDiscussions,
  listen, worldOpts, start, getJson, postJson, raw, ghCalls, tiles, scriptHead,
};
