//
// The shared prologue of the jobs/brief-payload.js suites, the `*.test.js`
// files beside this one, which test the payload the 9am job hands to Claude.
// A plain module, never a suite: the runner only loads files ending in
// `.test.js`.
//
// The whole composition runs here against a fixture roster: one
// real, opted-in git repo and one fake exec answering `gh` while passing `git`
// through to the real binary: the same seam the tower's server suite uses,
// because roster discovery and health ask git questions no stub answers
// honestly.
//
// Nothing here reaches the network, and nothing here runs Claude.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { testUnless } = require('../../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB, gitPath, homeEnv, pathWith, shellPath, stubTool } = require('../../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'jobs', 'brief-payload.js');
const { composeBrief, render, writeBriefMarks, INSTRUCTION } = require(SCRIPT);
const { parseStatsMark } = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'history.js'));

const SLUG = 'ITW-Creative-Works/fixture';
const STAMP = '2026-07-27T16:00:00.000Z';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brief-payload-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The upstream CHANGELOG the script reads, as a file on disk: the seam that
// keeps the news gather off the network. cc-news.test.js owns the parsing and
// filtering cases; this suite only asks whether the script wires it up.
const CC_CHANGELOG = '\n## 2.1.219\n\n- Added the `workflowSizeGuideline` settings key\n';

const ccFixture = (home) => {
  const file = path.join(home, 'cc-changelog.md');
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Changelog\n${CC_CHANGELOG}`);
  return file;
};

/**
 * A world for the news path: a scratch HOME naming a home repo, a `gh` shim
 * that answers the board read out of a file this suite rewrites, the CHANGELOG
 * on disk, and the scratch mark file the runner would name. Nothing here
 * reaches GitHub: the shim is first on PATH and never calls out.
 */
const mkNewsWorld = () => {
  const home = mkTmp();
  const bin = path.join(home, 'bin');
  const boardFile = path.join(home, 'board.json');
  const markFile = path.join(home, 'cc-version');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.workkit', 'settings.json'),
    JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
  );

  const setBoard = (nodes) => fs.writeFileSync(
    boardFile,
    JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
  );
  setBoard([]);
  stubTool(bin, 'gh', ['#!/usr/bin/env bash', `cat ${JSON.stringify(shellPath(boardFile))}`]);

  return {
    home,
    ccFile: ccFixture(home),
    /** What the last run handed the runner to append to the published brief. */
    mark: () => (fs.existsSync(markFile) ? fs.readFileSync(markFile, 'utf8') : ''),
    /** The brief the runner would have posted, now on the board. */
    publish: (version) => setBoard([{
      title: 'brief: 2026-07-29',
      body: `HEADLINE: yesterday happened.\n\n<!-- cc-news: ${version} -->\n`,
    }]),
    env: homeEnv(home, {
      ...process.env,
      PATH: pathWith(bin),
      WORKKIT_CC_CHANGELOG: pathToFileURL(ccFixture(home)).href,
      WORKKIT_BRIEF_MARK_FILE: markFile,
    }),
  };
};

const issueNode = (number, labels) => ({
  number,
  title: `issue ${number}`,
  url: `https://github.com/${SLUG}/issues/${number}`,
  updatedAt: '2026-07-27T00:00:00Z',
  labels: { nodes: labels.map((name) => ({ name })) },
  assignees: { nodes: [] },
});

/**
 * One opted-in repo with an origin, an unreleased CHANGELOG entry, and an
 * uncommitted file, registered in a scratch ~/.workkit roster, plus the exec
 * seam that answers gh and lets git through.
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
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- [#1](u) \u2014 One thing.\n'); // \u2014 is the CHANGELOG entry separator (U+2014)
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'initial');
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'uncommitted\n');

  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.workkit', '.repos.json'),
    JSON.stringify({ version: 1, repos: { [gitPath(repo)]: 'enabled' } }, null, 2),
  );

  const world = {
    root,
    repo,
    home,
    board: {
      data: {
        r0: {
          issues: {
            totalCount: 2,
            nodes: [
              issueNode(17, ['status:specced', 'agent:ok']),
              issueNode(18, ['status:blocked', 'priority:high']),
            ],
          },
        },
      },
    },
    ghMissing: false,
    // The home repo's Discussions, as the summaries read finds them. Empty until
    // a test publishes something, and unreachable only when it says so.
    discussions: [],
  };
  fs.mkdirSync(world.home, { recursive: true });

  world.exec = (cmd, args) => {
    if (cmd === 'git') return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (cmd === 'gh' && args[0] === '--version') {
      if (world.ghMissing) throw new Error('gh: command not found');
      return 'gh version 2.0.0\n';
    }
    if (cmd === 'gh' && args[0] === 'api') {
      // The two GraphQL reads a morning makes, told apart by the query itself:
      // the board sweep, and the summaries published on the home repo.
      if (args.join(' ').includes('discussions(first')) {
        if (world.discussionsError) throw world.discussionsError;
        return JSON.stringify({ data: { repository: { discussions: { nodes: world.discussions } } } });
      }
      if (world.boardError) throw world.boardError;
      return JSON.stringify(world.board);
    }
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  return world;
};

// What the run wrote to stderr while `fn` ran. The line the composer prints
// about unreadable repos goes there and nowhere else, so this is the only place
// to read it back.
const captureStderr = (fn) => {
  const original = process.stderr.write.bind(process.stderr);
  let text = '';
  process.stderr.write = (chunk) => { text += chunk; return true; };
  try { fn(); } finally { process.stderr.write = original; }
  return text;
};

const composeIn = (world, generatedAt = STAMP) => composeBrief({
  workflowHome: path.join(world.home, '.workkit'),
  home: world.home,
  generatedAt,
  exec: world.exec,
});

// The machine's hand-edited settings, naming the home repo the summaries are
// published on. A world without one is a machine that has no board at all.
const nameHomeRepo = (world, repo = 'owner/private-home') => fs.writeFileSync(
  path.join(world.home, '.workkit', 'settings.json'),
  JSON.stringify({ version: 1, site: { repo, publish: false, url: null } }),
);

const discussion = (title, day) => ({
  title,
  url: `https://github.com/owner/private-home/discussions/${title.replace(/\W+/g, '')}`,
  createdAt: `${day}T09:00:00Z`,
});

// Local noon, so the weekday is the same one wherever this suite runs.
const localNoon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
const MONDAY = localNoon(2026, 8, 3);
const TUESDAY = localNoon(2026, 8, 4);

// A case whose answer rests on the `gh` shim mkNewsWorld put on PATH, which
// the SCRIPT spawns itself. No stub a suite writes is startable by name from
// Node on Windows (tests/lib/platform.js, `stubTool`), so the machine's own
// gh answers the board read there. The world's env seals that gh to a scratch
// config, so what it answers is an empty board rather than the developer's,
// and an empty board is not what these cases are about.
const newsTest = testUnless(IS_WINDOWS, NO_NODE_STUB);

module.exports = {
  SCRIPT, composeBrief, render, writeBriefMarks, INSTRUCTION, parseStatsMark, SLUG, STAMP, mkTmp, cleanup,
  CC_CHANGELOG, ccFixture, mkNewsWorld, issueNode, mkWorld, captureStderr, composeIn, nameHomeRepo, discussion,
  MONDAY, TUESDAY, newsTest,
};
