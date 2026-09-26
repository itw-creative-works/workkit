//
// Tests for standards.sh: the engine's address (the ~/.claude/workkit link).
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, stubTool, joinPath,
} = require('../../lib/platform');
const { WORKFLOW_DIR, SCRIPT, mkTmp, cleanup, makeRepo, runScript } = require('./helpers');

const run = async () => {
  group("standards.sh: the engine's address");

  // ~/.claude/workkit → the engine. The step runs on a real HEAL from a
  // CANONICAL checkout: this suite's SCRIPT is that checkout, and every claude
  // home below is a temp directory, so the machine's own address is untouched.
  const ENGINE = path.resolve(WORKFLOW_DIR);
  const claudeHomeWith = () => {
    const home = mkTmp();
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    return { home, claude: path.join(home, '.claude') };
  };

  await test('links ~/.claude/workkit at the engine it is running from', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { claudeHome: claude });
    const link = path.join(claude, 'workkit');
    assertEq(fs.realpathSync(link), fs.realpathSync(ENGINE), 'the address points at this engine');
    assert(fs.lstatSync(link).isSymbolicLink(), 'and it is a symlink, not a copy');
    assert(output.includes('engine: linked'), `says so once, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('an address already correct is silent: the step is idempotent', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    runScript(repo, { claudeHome: claude });
    const { output } = runScript(repo, { claudeHome: claude });
    assert(!output.includes('engine:'), `a correct address says nothing, got: ${output}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'and stays put');
    cleanup(repo); cleanup(claude);
  });

  await test('an address pointing somewhere else is repaired', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const stale = mkTmp();
    fs.symlinkSync(stale, path.join(claude, 'workkit'));
    const { output } = runScript(repo, { claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'repointed at this engine');
    assert(output.includes('engine: repointed'), `and says so, got: ${output}`);
    cleanup(repo); cleanup(claude); cleanup(stale);
  });

  // The address is ONE path for the whole machine, so sessions opening at once
  // in several repos all write it. What it must never be is MISSING: a maker
  // that unlinks the address and then creates it leaves a gap, and a session
  // reading it in that gap finds no engine at all, while every one of those
  // sessions still exits 0 and registers its repo. Nothing but repetition can
  // see that, so the rounds are the case: three sessions, because that is the
  // smallest number with a loser reading while another one writes.
  await test('sessions writing the address at once never leave it missing', async () => {
    const { claude } = claudeHomeWith();
    const address = path.join(claude, 'workkit');
    const env = {
      ...process.env,
      PATH: joinPath(SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'workflow-home')),
      WORKFLOW_CLAUDE_HOME: shellPath(claude),
    };
    for (let round = 1; round <= 20; round++) {
      fs.rmSync(address, { recursive: true, force: true });
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([0, 1, 2].map(() => new Promise((resolve) => {
        const child = spawn(BASH, [...NO_RC, shellPath(SCRIPT), '--engine-link'], { env, stdio: 'ignore' });
        child.on('close', resolve);
      })));
      const made = fs.lstatSync(address, { throwIfNoEntry: false });
      assert(!!made && made.isSymbolicLink(), `round ${round}: the address is a symlink, not gone`);
      assertEq(fs.realpathSync(address), fs.realpathSync(ENGINE), `round ${round}: and it resolves to this engine`);
    }
    const stray = path.join(ENGINE, 'workflow');
    const strayed = fs.existsSync(stray);
    if (strayed) fs.rmSync(stray, { recursive: true, force: true });
    assert(!strayed, 'and no round wrote a link inside the engine folder');
    cleanup(claude);
  });

  // Git Bash without symlink rights answers `ln -s` with a COPY and exit 0.
  // A copy at the engine's address is worse than no address at all: the marker
  // scripts the skills call sit one level ABOVE the engine folder (#245), so a
  // copy of the engine hides them and every skill's fallback resolves into
  // ~/.claude. The `ln` stub below is that machine, on this one.
  await test('an `ln` that copies instead of linking: the copy is removed and named', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const bin = mkTmp();
    stubTool(bin, 'ln', [
      '#!/bin/bash',
      '# Git Bash without symlink rights: a copy, and exit 0.',
      'dst="${@: -1}"; src="${@: -2:1}"',
      'cp -R "$src" "$dst"',
    ]);
    const link = path.join(claude, 'workkit');
    const { output } = runScript(repo, { claudeHome: claude, pathPrefix: bin });
    assert(!fs.existsSync(link), `the copy is removed, not left at the address, got: ${output}`);
    assert(output.includes('engine:') && output.includes(shellPath(link)),
      `and the human is told, naming the address, got: ${output}`);
    assert(/symlink/.test(output), `and what is wrong with it, got: ${output}`);
    assert(!output.includes('engine: linked'), `never reported as linked, got: ${output}`);
    cleanup(repo); cleanup(claude); cleanup(bin);
  });

  await test('a REAL directory at the address is never replaced', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const real = path.join(claude, 'workkit');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'keep.txt'), 'mine\n');
    const { output } = runScript(repo, { claudeHome: claude });
    assert(fs.statSync(real).isDirectory() && !fs.lstatSync(real).isSymbolicLink(), 'the directory survives');
    assertEq(fs.readFileSync(path.join(real, 'keep.txt'), 'utf8'), 'mine\n', 'with its contents');
    assert(output.includes('is a real file or directory'), `and the human is told, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('no ~/.claude on the machine: nothing is created', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const claude = path.join(home, '.claude');
    const { output } = runScript(repo, { claudeHome: claude });
    assert(!fs.existsSync(claude), 'the engine creates no agent directory of its own');
    assert(!output.includes('engine:'), `and says nothing about it, got: ${output}`);
    cleanup(repo); cleanup(home);
  });

  // The address belongs to the machine's real engine, and only a real heal from
  // it may write one. A --state probe or a fixture copy that repointed it stole
  // the machine's engine from under every other session, which is exactly what
  // a partial-checkout test run did on 2026-07-29.
  await test('a probe never touches the address: --state and --announce', () => {
    for (const args of [['--state'], ['--announce']]) {
      const repo = makeRepo();
      const { claude } = claudeHomeWith();
      const { output } = runScript(repo, { args, claudeHome: claude });
      assert(!fs.existsSync(path.join(claude, 'workkit')), `${args[0]} asked a question and wrote nothing`);
      assert(!output.includes('engine:'), `and said nothing about the address, got: ${output}`);
      cleanup(repo); cleanup(claude);
    }
  });

  // The machine-side install (`workkit setup|update`) needs the address without
  // a heal of anything, and must not own a second copy of the step.
  await test('--engine-link writes the address and heals nothing', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { args: ['--engine-link'], claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(ENGINE), 'the address points at this engine');
    assert(!output.includes('standards:'), `and nothing else ran, got: ${output}`);
    cleanup(repo); cleanup(claude);
  });

  await test('a probe leaves an EXISTING address alone', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const other = mkTmp();
    fs.symlinkSync(other, path.join(claude, 'workkit'));
    runScript(repo, { args: ['--state'], claudeHome: claude });
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(other),
      'the address a probe found is the address it leaves');
    cleanup(repo); cleanup(claude); cleanup(other);
  });

  await test('a repo that has not said yes never repoints it', () => {
    const repo = makeRepo({ settings: null });
    const { claude } = claudeHomeWith();
    runScript(repo, { claudeHome: claude, workflowHome: path.join(mkTmp(), 'wh') });
    assert(!fs.existsSync(path.join(claude, 'workkit')), 'an undecided repo is offered, and nothing else happens');
    cleanup(repo); cleanup(claude);
  });

  await test('a NON-canonical copy of the engine leaves the address alone, silently', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    // A copy in a temp directory: no git repo above it, which is what a
    // fixture, an archive, or a partial checkout looks like.
    const copy = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal itself still runs: ${res.stderr}`);
    assert(!fs.existsSync(path.join(claude, 'workkit')), 'a copy is not the machine engine and takes no address');
    assert(!(res.stdout + res.stderr).includes('engine:'), `and says nothing: it is a skip, not a fault, got: ${res.stderr}`);
    cleanup(repo); cleanup(claude); cleanup(copy);
  });

  await test('a copy whose origin is some OTHER repo leaves it alone too', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    // A git repo this time, so only the origin tells the two apart.
    const copyRoot = mkTmp();
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    spawnSync('git', ['init', '-q'], { cwd: copyRoot });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/someone/not-the-kit.git'], { cwd: copyRoot });
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal itself still runs: ${res.stderr}`);
    assert(!fs.existsSync(path.join(claude, 'workkit')), 'the origin is what makes a checkout the machine engine');
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  await test('a copy whose origin IS the kit takes the address', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const copyRoot = mkTmp();
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    spawnSync('git', ['init', '-q'], { cwd: copyRoot });
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:ITW-Creative-Works/workkit.git'], { cwd: copyRoot });
    runScript(repo, { claudeHome: claude });   // prime it with THIS engine first
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal runs: ${res.stderr}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(copy),
      'a second real checkout is still a real checkout: the address follows the one that ran');
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  await test('an origin spelled as a native Windows path is the kit too', () => {
    // The canonical gate reads the SLUG through the engine's one rule
    // (wk_slug_from_remote, workflow/slug.sh), so it takes a remote in either
    // separator: git stores a path exactly as it was typed, and a checkout
    // cloned from a local path on Windows carries backslashes. A gate that
    // took only a forward slash refused the machine's own engine there.
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const copyRoot = mkTmp();
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    spawnSync('git', ['init', '-q'], { cwd: copyRoot });
    spawnSync('git', ['remote', 'add', 'origin', 'C:\\Users\\x\\kits\\workkit.git'], { cwd: copyRoot });
    runScript(repo, { claudeHome: claude });   // prime it with THIS engine first
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal runs: ${res.stderr}`);
    assertEq(fs.realpathSync(path.join(claude, 'workkit')), fs.realpathSync(copy),
      'a natively spelled origin names the kit, so the checkout takes the address');
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
