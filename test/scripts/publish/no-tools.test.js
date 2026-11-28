// Tests for workflow/publish.js on a machine with none of the file tools the
// shell once leaned on: no jq, awk, tar, find or cp on PATH, and a whole
// publish still runs every step. The kit is committed, so every export of
// committed files (the heal's kit, the sync's app) goes through git. The world
// is publish-sync's ./helpers.js, with stand-ins that need no cp either.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const {
  joinPath, which, spawnSync, stubToolJs,
} = require('../../lib/platform');
const {
  recordArgvJs, readArgv, isCall, eqArgv, fmtCalls,
} = require('../../lib/argv-log');
const { git, pathWithout } = require('./helpers');
const { cleanup, writeJson, mkPublishWorld, publish, fromPages } = require('../publish-sync/helpers');

const GONE = ['jq', 'awk', 'tar', 'find', 'cp'];

/**
 * mkPublishWorld with the kit committed, `site.url` set so the CNAME step
 * writes, a `gh` that records its argv, and an `npm` whose build copies the
 * page in Node alone. `PATH` is the stand-ins ahead of a mirror without GONE.
 */
const mkBareWorld = () => {
  const world = mkPublishWorld();
  const bin = path.join(world.root, 'bin');
  git(world.kit, 'init', '-q', '-b', 'main');
  git(world.kit, 'add', '-A');
  git(world.kit, '-c', 'user.name=kit', '-c', 'user.email=kit@localhost', 'commit', '-q', '-m', 'chore: the kit');

  const settings = path.join(world.root, 'workflow-home', 'settings.json');
  const current = JSON.parse(fs.readFileSync(settings, 'utf8'));
  writeJson(settings, { ...current, site: { ...current.site, url: 'https://board.example.com' } });

  const ghLog = path.join(world.root, 'gh-argv.log');
  stubToolJs(bin, 'gh', recordArgvJs(JSON.stringify(ghLog)));
  const npmLog = path.join(world.root, 'npm.log');
  stubToolJs(bin, 'npm', [
    "const fs = require('fs');",
    "const path = require('path');",
    recordArgvJs(JSON.stringify(npmLog), '[process.cwd(), ...process.argv.slice(2)]'),
    'const args = process.argv.slice(2);',
    "const prefix = args[0] === '--prefix' ? args[1] : process.cwd();",
    "if (args[0] === 'install') {",
    "  fs.mkdirSync(path.join(prefix, 'node_modules'), { recursive: true });",
    "  fs.writeFileSync(path.join(prefix, 'node_modules', '.package-lock.json'), '');",
    '} else {',
    "  fs.mkdirSync(path.join(prefix, 'dist'), { recursive: true });",
    "  fs.writeFileSync(path.join(prefix, 'dist', 'index.html'), fs.readFileSync(path.join(prefix, 'src', 'index.html')));",
    '}',
  ].join('\n'));

  const PATH = joinPath(bin, pathWithout(...GONE));
  return {
    ...world,
    PATH,
    env: { ...world.env, PATH },
    ghCalls: () => readArgv(ghLog),
  };
};

describe('workflow/publish: no jq, awk, tar, find or cp', () => {
  test('a whole publish runs every step and the site is published', () => {
    const world = mkBareWorld();
    expect(GONE.filter((tool) => which(tool, world.PATH)).join(','), 'the PATH holds none of the five').toBe('');

    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);

    const pages = fromPages(world);
    expect(pages, `the site published: ${out}${err}`).toBeTruthy();
    expect(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), 'the page is the synced app\'s, built and mirrored').toBe('<html>the current board</html>\n');
    expect(fs.existsSync(path.join(pages, '.nojekyll')), 'with the mirror\'s .nojekyll').toBeTruthy();
    expect(fs.readFileSync(path.join(pages, 'data', 'home.json'), 'utf8'), 'the home pointer').toBe('{"home":"owner/workkit","branch":"main"}\n');
    expect(fs.readFileSync(path.join(pages, 'CNAME'), 'utf8'), 'the custom URL').toBe('board.example.com\n');

    const main = path.join(world.root, 'main-check');
    spawnSync('git', ['clone', '-q', world.bare, main], { encoding: 'utf8' });
    expect(JSON.parse(fs.readFileSync(path.join(main, 'data', 'repos.json'), 'utf8')).repos, 'the roster on the default branch').toEqual(['owner/workkit']);
    expect(fs.readFileSync(path.join(main, 'targets', 'web', 'src', 'index.html'), 'utf8'), 'the synced project pushed to it').toBe('<html>the current board</html>\n');
    expect(spawnSync('git', ['-C', main, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim(), 'under the sync\'s subject').toBe('chore(home): sync the tower project');

    expect(world.ghCalls().some((call) => isCall(call, 'label', 'list')), `the heal ran: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(world.npms().filter((call) => eqArgv(call.slice(1), ['install'])).length, `one install: ${fmtCalls(world.npms())}`).toBe(1);
    expect(world.npms().filter((call) => eqArgv(call.slice(-2), ['run', 'build'])).length, `one build: ${fmtCalls(world.npms())}`).toBe(1);
    expect(world.mints().length, `one mint: ${fmtCalls(world.mints())}`).toBe(1);
    const worktrees = spawnSync('git', ['-C', world.tower, 'worktree', 'list'], { encoding: 'utf8' }).stdout;
    expect(worktrees.trim().split('\n').length, `the published branch's worktree is gone: ${worktrees}`).toBe(1);
    cleanup(world.root);
  });
});
