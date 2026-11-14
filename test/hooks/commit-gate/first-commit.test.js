// Tests for safety:commit-gate's first commit, preCommitVerdict over a real
// scratch repo with no HEAD (test/lib/real-gate.js): the gate stands down with
// one line, and once that commit exists the next code commit is judged again.
// A HEAD git cannot read, or a read that never starts, is not that: the commit is held, naming the read.
// A repo with a HEAD is every other suite beside this one.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const { gateOn } = require('../../lib/real-gate');
const { PREFIX, T, NOTICE, pkg } = require('./helpers');

// A fresh repo before its first commit: the opt-in, a root test script and a
// code file staged, no HEAD, no review marker and no suite record.
const mkUnbornRepo = () => {
  const world = mkGitRepo('cg-first-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
  world.git('update-ref', '-d', 'HEAD');
  return world;
};

const commitOn = (world) => gateOn(world.repo, world.env);

describe('commit-gate: a repo with no HEAD', () => {
  test('staged code, no review marker, no suite record, no HEAD: the stand-down line, never a deny', async () => {
    const world = mkUnbornRepo();
    const out = await commitOn(world);
    expect(out.deny, 'the first commit is never blocked').toBe(null);
    expect(out.context, 'it passes saying the gate stood down').toBe(NOTICE.firstCommit);
  });

  test('after that first commit, the next code commit is judged again: the review is asked for', async () => {
    const world = mkUnbornRepo();
    world.git('commit', '-q', '-m', 'feat: first');
    world.write('app.js', 'const x = 2;\n');
    world.git('add', 'app.js');
    const out = await commitOn(world);
    expect(out.deny, 'a repo with a HEAD gets the full gate').toBe(`${PREFIX}${T.noReview}`);
  });

  test('a HEAD git cannot read (its commit object gone): the commit is held naming the read, never a stand-down', async () => {
    const world = mkGitRepo('cg-first-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
    const sha = world.git('rev-parse', 'HEAD').trim();
    fs.rmSync(path.join(world.repo, '.git', 'objects', sha.slice(0, 2), sha.slice(2)));
    world.write('app.js', 'const x = 2;\n');
    world.git('add', 'app.js');
    const out = await commitOn(world);
    expect(out.deny?.startsWith(PREFIX), `the commit is blocked, got: ${out.deny}`).toBeTruthy();
    expect(out.deny.includes('the HEAD time check could not run: `git log -1 --format=%ct` exited 128 (fatal: bad object HEAD)'), `naming the failed read, got: ${out.deny}`).toBeTruthy();
  });

  test('a staged list git cannot read (the HEAD tree object gone): the commit is held naming the read, never "nothing staged"', async () => {
    const world = mkGitRepo('cg-first-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
    const tree = world.git('rev-parse', 'HEAD^{tree}').trim();
    fs.rmSync(path.join(world.repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));
    world.write('app.js', 'const x = 2;\n');
    world.git('add', 'app.js');
    const out = await commitOn(world);
    expect(out.deny?.startsWith(PREFIX), `the commit is blocked, got: ${out.deny}`).toBeTruthy();
    expect(out.deny.includes('the staged files check could not run: `git -c core.quotePath=false diff --cached --name-only` exited 128 (error: bad tree object HEAD)'), `naming the failed read, got: ${out.deny}`).toBeTruthy();
  });

  test('a HEAD time read or a staged list read that did not start: the commit is held naming the read and did not start', async () => {
    const reads = [
      ['the HEAD time check', (argv) => argv.includes('log') && argv.includes('--format=%ct')],
      ['the staged files check', (argv) => argv.includes('diff') && argv.includes('--cached') && argv.includes('--name-only') && !argv.some((a) => a.startsWith('--diff-filter'))],
    ];
    for (const [check, unstarted] of reads) {
      const world = mkGitRepo('cg-first-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
      world.write('app.js', 'const x = 2;\n');
      world.git('add', 'app.js');
      const out = await gateOn(world.repo, world.env, { unstarted: (argv) => path.basename(argv[0]) === 'git' && unstarted(argv) });
      expect(out.deny?.startsWith(PREFIX), `${check}: the commit is blocked, got: ${out.deny}`).toBeTruthy();
      expect(new RegExp(`${check} could not run: \`git [^\`]+\` did not start`).test(out.deny), `${check}: naming the read and did not start, got: ${out.deny}`).toBeTruthy();
    }
  });
});
