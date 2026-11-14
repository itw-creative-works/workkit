// Tests for changedSince(io, root, ms) in hooks/mods/changed.js, over a real io and a real scratch repo: the
// repo-relative paths git lists as modified or untracked (ignored files left out), plus .workkit/capture.md and
// .workkit/agents/session.md, which git ignores, each kept only when its modified time is at or after `ms`.
// The disk check that runs the write checks on that list: test/hooks/script-write.test.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, seeded,
} = require('../lib/harness');
const { homeEnv, spawnSync } = require('../lib/platform');
const { mods } = require('../lib/mods-inputs');
const { ioIn } = require('../../workflow/lib/io');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

// The call's start, whole seconds so every filesystem keeps the mtimes set around it exactly.
const START = Math.floor(Date.now() / 1000) * 1000;
const BEFORE = new Date(START - 60000);
const AFTER = new Date(START + 1000);

// A repo with a tracked file, the kit's ignore lines for .workkit, and both .workkit files, all committed
// or written before the start.
const seed = seeded((dir) => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.workkit', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home'));
  fs.writeFileSync(path.join(repo, 'src.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(repo, 'old.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.workkit/*\n!.workkit/settings.json\nbuild/\n');
  fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
  const env = homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH });
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'],
    ['add', '-A'], ['commit', '-q', '-m', 'init']]) {
    const res = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  }
  fs.writeFileSync(path.join(repo, '.workkit', 'capture.md'), '# capture\n');
  fs.writeFileSync(path.join(repo, '.workkit', 'agents', 'session.md'), '# session\n');
});

/**
 * A fresh copy of the world: `{ repo, io, write(rel, text, at), git(...args) }`, every seeded file dated before
 * the start; `git` runs in the repo with the scratch home and answers its stdout, throwing on a non-zero exit.
 */
const mkWorld = () => {
  const dir = mkTmp('wk-changed-');
  seed(dir);
  const repo = path.join(dir, 'repo');
  const env = homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH });
  const git = (...args) => {
    const res = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout;
  };
  const write = (rel, text, at) => {
    const file = path.join(repo, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (text !== null) fs.writeFileSync(file, text);
    fs.utimesSync(file, at, at);
  };
  for (const rel of ['src.js', 'old.js', '.gitignore', '.workkit/settings.json', '.workkit/capture.md', '.workkit/agents/session.md']) {
    write(rel, null, BEFORE);
  }
  return { repo, io: ioIn(env), write, git };
};

const changed = async (world) => [...await mods('changed').changedSince(world.io, world.repo, START)].sort();

describe('changedSince: what a call changed', () => {
  test('a tracked file rewritten and an untracked file made after the start are listed by repo-relative path', async () => {
    const world = mkWorld();
    world.write('src.js', 'module.exports = 2;\n', AFTER);
    world.write('lib/new.js', 'module.exports = 3;\n', AFTER);
    expect(JSON.stringify(await changed(world)), 'both, and nothing else').toBe(JSON.stringify(['lib/new.js', 'src.js']));
  });

  test('a file last modified before the call began is not listed, though git shows it modified', async () => {
    const world = mkWorld();
    world.write('old.js', 'module.exports = 9;\n', BEFORE);
    world.write('src.js', 'module.exports = 2;\n', AFTER);
    const status = world.git('status', '--porcelain');
    expect(status.includes('old.js'), `git shows old.js modified, got: ${status}`).toBe(true);
    expect(JSON.stringify(await changed(world)), 'old.js left out').toBe(JSON.stringify(['src.js']));
  });

  test('a file written and staged after the start is listed, a new one and a tracked one alike', async () => {
    const world = mkWorld();
    world.write('src.js', 'module.exports = 2;\n', AFTER);
    world.write('lib/staged.js', 'module.exports = 4;\n', AFTER);
    world.git('add', 'src.js', 'lib/staged.js');
    expect(JSON.stringify(await changed(world)), 'both staged files').toBe(JSON.stringify(['lib/staged.js', 'src.js']));
  });

  test('the two .workkit files git ignores are listed when changed after the start, another ignored file never', async () => {
    const world = mkWorld();
    world.write('.workkit/capture.md', '# capture\n\n- a thought\n', AFTER);
    world.write('.workkit/agents/session.md', '# session\n\nnotes\n', AFTER);
    world.write('build/out.js', 'x\n', AFTER);
    expect(JSON.stringify(await changed(world)), 'the two, the build output left out').toBe(JSON.stringify(['.workkit/agents/session.md', '.workkit/capture.md']));
  });

  test('a call that changes no file lists nothing, the .workkit files included', async () => {
    expect(JSON.stringify(await changed(mkWorld())), 'nothing').toBe('[]');
  });

  test('changedSince called twice with the same root and time answers the same list both times', async () => {
    const world = mkWorld();
    world.write('src.js', 'module.exports = 2;\n', AFTER);
    world.write('.workkit/capture.md', '# capture\n\n- a thought\n', AFTER);
    const first = await mods('changed').changedSince(world.io, world.repo, START);
    const second = await mods('changed').changedSince(world.io, world.repo, START);
    expect(JSON.stringify(second), 'the same list').toBe(JSON.stringify(first));
    expect(JSON.stringify([...first].sort()), 'and it is the changed files').toBe(JSON.stringify(['.workkit/capture.md', 'src.js']));
  });
});
