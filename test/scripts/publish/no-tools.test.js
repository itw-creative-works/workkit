// Tests for workflow/publish.js on a machine with none of the file tools the
// shell once leaned on: no jq, awk, tar, find or cp on PATH, and a whole
// publish still runs every step. The kit is committed, so every export of
// committed files (the heal's kit, the sync's app) goes through git. The world
// is publish-sync's ./helpers.js, with stand-ins that need no cp either.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const {
  shellPath, joinPath, which, spawnSync,
} = require('../../lib/platform');
const { git, writeStub, binDirWithout } = require('./helpers');
const { cleanup, writeJson, mkPublishWorld, publish, fromPages } = require('../publish-sync/helpers');

const GONE = ['jq', 'awk', 'tar', 'find', 'cp'];

/**
 * mkPublishWorld with the kit committed, `site.url` set so the CNAME step
 * writes, a `gh` that records its argv, and an `npm` whose build copies the
 * page with bash alone. `PATH` is the stand-ins ahead of a mirror without GONE.
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
  writeStub(path.join(bin, 'gh'), [`printf '%s\\n' "$*" >> ${JSON.stringify(shellPath(ghLog))}`, 'exit 0']);
  const npmLog = path.join(world.root, 'npm.log');
  writeStub(path.join(bin, 'npm'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(npmLog))}`,
    'prefix="$PWD"',
    'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
    'if [[ "$1" == install ]]; then',
    '  mkdir -p "$prefix/node_modules" && : > "$prefix/node_modules/.package-lock.json"',
    '  exit 0',
    'fi',
    'mkdir -p "$prefix/dist"',
    'while IFS= read -r line; do printf \'%s\\n\' "$line"; done < "$prefix/src/index.html" > "$prefix/dist/index.html"',
    'exit 0',
  ]);

  const PATH = joinPath(bin, binDirWithout(...GONE));
  return {
    ...world,
    PATH,
    env: { ...world.env, PATH },
    ghCalls: () => fs.readFileSync(ghLog, 'utf8').trim().split('\n'),
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

    expect(world.ghCalls().some((argv) => /label list/.test(argv)), `the heal ran: ${world.ghCalls().join(' | ')}`).toBeTruthy();
    expect(world.npms().filter((call) => call.endsWith('|install')).length, `one install: ${world.npms().join(' | ')}`).toBe(1);
    expect(world.npms().filter((call) => call.endsWith('run build')).length, `one build: ${world.npms().join(' | ')}`).toBe(1);
    expect(world.mints().length, `one mint: ${world.mints().join(' | ')}`).toBe(1);
    const worktrees = spawnSync('git', ['-C', world.tower, 'worktree', 'list'], { encoding: 'utf8' }).stdout;
    expect(worktrees.trim().split('\n').length, `the published branch's worktree is gone: ${worktrees}`).toBe(1);
    cleanup(world.root);
  });
});
