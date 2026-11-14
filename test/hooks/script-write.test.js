// Tests for safety:script-write, the disk check after a Bash call: its entry on POST_BASH_GUARDS
// (hooks/mods/guards.js) run with a real io over a real repo, after a real shell ran the call. Each file the call
// changed in an opted-in root gets the write checks an Edit gets; a failed check is a notice naming the file and the
// check, never a deny, and the file stays as written. Since the check reads the disk, every spelling of a write is
// the same fact. The wiring through the hooks module is test/mods/guards-script-write.test.ts.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, seeded, SPAWN_DEADLINE,
} = require('../lib/harness');
const { NO_RC, homeEnv, spawnBash, spawnSync } = require('../lib/platform');
const { mods, textOf } = require('../lib/mods-inputs');
const { ioIn } = require('../../workflow/lib/io');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const HOOK = 'safety:script-write';
const LINK = '[#4](https://github.com/o/r/issues/4)';
const DOC = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- ${LINK} - A good entry.\n\n- PLACEHOLDER\n`;
const BAD = 'An entry with no issue link.';
const SEEDED = ['CHANGELOG.md', 'bin/entry.sh', '.gitignore', '.workkit/settings.json'];

// One opted-in repo: a CHANGELOG and a script that appends a bad entry to it, committed.
const seed = seeded((dir) => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), DOC);
  fs.writeFileSync(path.join(repo, 'bin', 'entry.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' '- ${BAD}' >> CHANGELOG.md\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, '.gitignore'), '.workkit/*\n!.workkit/settings.json\n');
  fs.mkdirSync(path.join(repo, '.workkit'));
  fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'],
    ['add', '-A'], ['commit', '-q', '-m', 'init']]) {
    const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: homeEnv(dir, { PATH: process.env.PATH }) });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  }
});

/** A fresh copy of the opted-in repo under `dir` as `name`, every seeded file dated a minute back. */
const repoIn = (dir, name) => {
  const at = path.join(dir, name);
  seed(at);
  const repo = path.join(at, 'repo');
  const before = new Date(Date.now() - 60000);
  for (const rel of SEEDED) fs.utimesSync(path.join(repo, rel), before, before);
  return repo;
};

/** A world of two opted-in repos and a home. */
const mkWorld = () => {
  const dir = mkTmp('wk-script-write-');
  fs.mkdirSync(path.join(dir, 'home'));
  return {
    repo: repoIn(dir, 'a'), other: repoIn(dir, 'b'), env: homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH }),
  };
};

/**
 * Runs `line` in a real bash from `from`, then the disk check for a call that began just before it there and
 * ended in `cwd`, `roots` the two repo roots. A second of slack before the start covers a filesystem whose clock
 * trails the process's. Returns the chain's answer: `notice` as text, `deny` and `error` as the chain gave them.
 */
const callThen = async (world, line, { from = world.repo, cwd = from, roots = [from] } = {}) => {
  const since = Date.now() - 1000;
  const res = spawnBash([...NO_RC, '-c', line], { cwd: from, env: world.env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  expect(res.status, `the call ran: ${line}, stderr: ${res.stderr}`).toBe(0);
  const entry = mods('guards').POST_BASH_GUARDS.filter((g) => g.hook === HOOK);
  expect(entry.length, `${HOOK} is on the after-call chain once`).toBe(1);
  const chain = await mods('guards').runChain(ioIn(world.env), world.env, entry, { cwd, background: false, since, roots });
  return { notice: textOf(chain.notice), deny: chain.deny, error: chain.error };
};

const changelog = (repo) => fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');

describe('script-write: a bad CHANGELOG entry, however the call wrote it', () => {
  test('sed -i, a redirect, tee and a script run by name each get the notice naming the file and docs:changelog-guard, the file left as written', async () => {
    for (const [line, label] of [
      [`sed -i.bak 's/PLACEHOLDER/${BAD}/' CHANGELOG.md`, 'sed -i'],
      [`printf '%s\\n' '- ${BAD}' >> CHANGELOG.md`, 'a redirect'],
      [`printf '%s\\n' '- ${BAD}' | tee -a CHANGELOG.md > /dev/null`, 'tee'],
      ['./bin/entry.sh', 'a script run by name'],
    ]) {
      const world = mkWorld();
      const r = await callThen(world, line);
      expect(!r.deny && !r.error, `${label}: neither a deny nor a crash, got: ${r.deny || r.error}`).toBeTruthy();
      expect(r.notice.includes('CHANGELOG.md'), `${label}: the notice names the file, got: ${r.notice}`).toBeTruthy();
      expect(r.notice.includes('docs:changelog-guard'), `${label}: and the check, got: ${r.notice}`).toBeTruthy();
      expect(r.notice.includes('changed during this Bash call'), `${label}: says the file changed during the call, got: ${r.notice}`).toBeTruthy();
      expect(!r.notice.includes('a Bash call changed'), `${label}: never that this call wrote it, got: ${r.notice}`).toBeTruthy();
      expect(changelog(world.repo).includes(BAD), `${label}: the file stays as written`).toBeTruthy();
    }
  });
});

describe('script-write: where it looks', () => {
  test('a call that changes no file: no notice', async () => {
    const r = await callThen(mkWorld(), 'ls > /dev/null');
    expect(r.notice, 'nothing said').toBe('');
  });

  test('a call that starts in one opted-in repo and writes in a second: the second repo\'s file is checked', async () => {
    const world = mkWorld();
    const r = await callThen(world, `cd ../../b/repo && printf '%s\\n' '- ${BAD}' >> CHANGELOG.md`,
      { cwd: world.other, roots: [world.repo, world.other] });
    expect(r.notice.includes('docs:changelog-guard'), `the second repo's CHANGELOG is checked, got: ${r.notice}`).toBeTruthy();
  });
});
