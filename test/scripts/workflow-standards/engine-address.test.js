// Tests for standards.sh: the engine's address (the ~/.claude/workkit link).
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE, start,
} = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, gitPath, stubTool, joinPath,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, SCRIPT, cleanup, makeRepo, runScript, claudeHomeWith, copyDefaults,
} = require('./helpers');
const { mkPluginCopy } = require('../../lib/plugin-copy');
const { mkOriginRepo } = require('../../lib/git-repo');

describe("standards.sh: the engine's address", () => {
  // ~/.claude/workkit → the engine. The step runs on a real heal from a
  // canonical checkout: this suite's SCRIPT is that checkout, and every claude
  // home below is a temp directory, so the machine's own address is untouched.
  const ENGINE = path.resolve(WORKFLOW_DIR);

  test('links ~/.claude/workkit at the engine it is running from', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { claudeHome: claude });
    const link = path.join(claude, 'workkit');
    expect(fs.realpathSync(link), 'the address points at this engine').toBe(fs.realpathSync(ENGINE));
    expect(fs.lstatSync(link).isSymbolicLink(), 'and it is a symlink, not a copy').toBeTruthy();
    expect(output.includes('engine: linked'), `says so once, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(claude);
  });

  test('an address already correct is silent: the step is idempotent', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    runScript(repo, { claudeHome: claude });
    const { output } = runScript(repo, { claudeHome: claude });
    expect(!output.includes('engine:'), `a correct address says nothing, got: ${output}`).toBeTruthy();
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'and stays put').toBe(fs.realpathSync(ENGINE));
    cleanup(repo); cleanup(claude);
  });

  test('an address pointing somewhere else is repaired', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const stale = mkTmp('wf-std-');
    fs.symlinkSync(stale, path.join(claude, 'workkit'));
    const { output } = runScript(repo, { claudeHome: claude });
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'repointed at this engine').toBe(fs.realpathSync(ENGINE));
    expect(output.includes('engine: repointed'), `and says so, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(claude); cleanup(stale);
  });

  // The address is one path for the machine, so sessions opening at once all
  // write it, and it must never be missing: a maker that unlinks and then creates
  // leaves a gap a reading session falls into. Only repetition sees that, and
  // three is the smallest race with a loser reading while another one writes.
  test('sessions writing the address at once never leave it missing', async () => {
    const { claude } = claudeHomeWith();
    const address = path.join(claude, 'workkit');
    const env = {
      ...process.env,
      PATH: joinPath(SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'workflow-home')),
      WORKFLOW_CLAUDE_HOME: shellPath(claude),
    };
    for (let round = 1; round <= 20; round++) {
      fs.rmSync(address, { recursive: true, force: true });
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([0, 1, 2].map(() => start(BASH, [...NO_RC, shellPath(SCRIPT), '--engine-link'], { env }).done));
      const made = fs.lstatSync(address, { throwIfNoEntry: false });
      expect(!!made && made.isSymbolicLink(), `round ${round}: the address is a symlink, not gone`).toBeTruthy();
      expect(fs.realpathSync(address), `round ${round}: and it resolves to this engine`).toBe(fs.realpathSync(ENGINE));
    }
    const stray = path.join(ENGINE, 'workflow');
    const strayed = fs.existsSync(stray);
    if (strayed) fs.rmSync(stray, { recursive: true, force: true });
    expect(!strayed, 'and no round wrote a link inside the engine folder').toBeTruthy();
    cleanup(claude);
  });

  // Git Bash without symlink rights answers `ln -s` with a copy and exit 0. A
  // copy hides the marker scripts one level above the engine folder, so every
  // skill's fallback resolves into ~/.claude. The `ln` stub below is that
  // machine, on this one.
  test('an `ln` that copies instead of linking: the copy is removed and named', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const bin = mkTmp('wf-std-');
    stubTool(bin, 'ln', [
      '#!/bin/bash',
      '# Git Bash without symlink rights: a copy, and exit 0.',
      'dst="${@: -1}"; src="${@: -2:1}"',
      'cp -R "$src" "$dst"',
    ]);
    const link = path.join(claude, 'workkit');
    const { output } = runScript(repo, { claudeHome: claude, pathPrefix: bin });
    expect(!fs.existsSync(link), `the copy is removed, not left at the address, got: ${output}`).toBeTruthy();
    expect(output.includes('engine:') && output.includes(gitPath(link)),
      `and the human is told, naming the address, got: ${output}`).toBeTruthy();
    expect(/symlink/.test(output), `and what is wrong with it, got: ${output}`).toBeTruthy();
    expect(!output.includes('engine: linked'), `never reported as linked, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(claude); cleanup(bin);
  });

  test('a REAL directory at the address is never replaced', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const real = path.join(claude, 'workkit');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'keep.txt'), 'mine\n');
    const { output } = runScript(repo, { claudeHome: claude });
    expect(fs.statSync(real).isDirectory() && !fs.lstatSync(real).isSymbolicLink(), 'the directory survives').toBeTruthy();
    expect(fs.readFileSync(path.join(real, 'keep.txt'), 'utf8'), 'with its contents').toBe('mine\n');
    expect(output.includes('is a real file or directory'), `and the human is told, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(claude);
  });

  test('no ~/.claude on the machine: nothing is created', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    const claude = path.join(home, '.claude');
    const { output } = runScript(repo, { claudeHome: claude });
    expect(!fs.existsSync(claude), 'the engine creates no agent directory of its own').toBeTruthy();
    expect(!output.includes('engine:'), `and says nothing about it, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(home);
  });

  // The address belongs to the machine's real engine, and only a real heal from
  // it may write one: a probe or a fixture copy that repointed it would steal the
  // engine from under every other session.
  test('a probe never touches the address: --state and --announce', () => {
    for (const args of [['--state'], ['--announce']]) {
      const repo = makeRepo();
      const { claude } = claudeHomeWith();
      const { output } = runScript(repo, { args, claudeHome: claude });
      expect(!fs.existsSync(path.join(claude, 'workkit')), `${args[0]} asked a question and wrote nothing`).toBeTruthy();
      expect(!output.includes('engine:'), `and said nothing about the address, got: ${output}`).toBeTruthy();
      cleanup(repo); cleanup(claude);
    }
  });

  // The machine-side install (`workkit setup|update`) needs the address without
  // a heal of anything, and must not own a second copy of the step.
  test('--engine-link writes the address and heals nothing', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const { output } = runScript(repo, { args: ['--engine-link'], claudeHome: claude });
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'the address points at this engine').toBe(fs.realpathSync(ENGINE));
    expect(!output.includes('standards:'), `and nothing else ran, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(claude);
  });

  test('a probe leaves an EXISTING address alone', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const other = mkTmp('wf-std-');
    fs.symlinkSync(other, path.join(claude, 'workkit'));
    runScript(repo, { args: ['--state'], claudeHome: claude });
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'the address a probe found is the address it leaves').toBe(fs.realpathSync(other));
    cleanup(repo); cleanup(claude); cleanup(other);
  });

  test('a repo that has not said yes never repoints it', () => {
    const repo = makeRepo({ settings: null });
    const { claude } = claudeHomeWith();
    runScript(repo, { claudeHome: claude, workflowHome: path.join(mkTmp('wf-std-'), 'wh') });
    expect(!fs.existsSync(path.join(claude, 'workkit')), 'an undecided repo is offered, and nothing else happens').toBeTruthy();
    cleanup(repo); cleanup(claude);
  });

  test('a NON-canonical copy of the engine leaves the address alone, silently', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    // A copy in a temp directory: no git repo above it, which is what a
    // fixture, an archive, or a partial checkout looks like.
    const copyRoot = mkTmp('wf-std-');
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    copyDefaults(copyRoot);
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the heal itself still runs: ${res.stderr}`).toBe(0);
    expect(!fs.existsSync(path.join(claude, 'workkit')), 'a copy is not the machine engine and takes no address').toBeTruthy();
    expect(!(res.stdout + res.stderr).includes('engine:'), `and says nothing: it is a skip, not a fault, got: ${res.stderr}`).toBeTruthy();
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  test('a copy whose origin is some OTHER repo leaves it alone too', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    // A git repo this time, so only the origin tells the two apart.
    const copyRoot = mkTmp('wf-std-');
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    copyDefaults(copyRoot);
    mkOriginRepo(copyRoot, 'https://github.com/someone/not-the-kit.git');
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the heal itself still runs: ${res.stderr}`).toBe(0);
    expect(!fs.existsSync(path.join(claude, 'workkit')), 'the origin is what makes a checkout the machine engine').toBeTruthy();
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  test('a copy whose origin IS the kit takes the address', () => {
    const repo = makeRepo();
    const { claude } = claudeHomeWith();
    const copyRoot = mkTmp('wf-std-');
    const copy = path.join(copyRoot, 'workflow');
    fs.mkdirSync(copy, { recursive: true });
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, copy]);
    copyDefaults(copyRoot);
    mkOriginRepo(copyRoot, 'git@github.com:ITW-Creative-Works/workkit.git');
    runScript(repo, { claudeHome: claude });   // prime it with THIS engine first
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env,
        PATH: joinPath(SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')),
        WORKFLOW_CLAUDE_HOME: shellPath(claude),
      },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the heal runs: ${res.stderr}`).toBe(0);
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'a second real checkout is still a real checkout: the address follows the one that ran').toBe(fs.realpathSync(copy));
    cleanup(repo); cleanup(claude); cleanup(copyRoot);
  });

  // A plugin install is a copy with no git under it: Claude's plugin cache,
  // `<claude home>/plugins/cache/<marketplace>/<plugin>/<version>/`, whose
  // manifest names the kit. That place, not an origin, makes it the engine.
  const engineLinkFrom = (copy, claude) => spawnSync(BASH, [...NO_RC, shellPath(path.join(copy, 'standards.sh')), '--engine-link'], {
    env: {
      ...process.env,
      PATH: joinPath(SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')),
      WORKFLOW_CLAUDE_HOME: shellPath(claude),
    },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });

  test('a copy in the plugin cache takes the address', () => {
    const { claude } = claudeHomeWith();
    const copy = mkPluginCopy(path.join(claude, 'plugins', 'cache', 'workkit', 'workkit', '0.0.0'));
    const res = engineLinkFrom(copy, claude);
    expect(res.status, `the step runs: ${res.stderr}`).toBe(0);
    const link = path.join(claude, 'workkit');
    expect(fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink(), `the address is a symlink, got: ${res.stderr}`).toBeTruthy();
    expect(fs.realpathSync(link), 'and it resolves to the cached engine').toBe(fs.realpathSync(copy));
    expect(res.stderr.includes('engine: linked'), `and says so, got: ${res.stderr}`).toBeTruthy();
    cleanup(claude);
  });

  // A claude home that is itself a symlink (a dotfiles-managed ~/.claude):
  // the engine's own path is physical, the home's is not, and both name one place.
  test('a copy in the cache of a symlinked claude home takes the address', () => {
    const { claude: real } = claudeHomeWith();
    const claude = path.join(mkTmp('wf-std-'), '.claude');
    fs.symlinkSync(real, claude);
    const copy = mkPluginCopy(path.join(real, 'plugins', 'cache', 'workkit', 'workkit', '0.0.0'));
    const res = engineLinkFrom(copy, claude);
    expect(res.status, `the step runs: ${res.stderr}`).toBe(0);
    const link = path.join(claude, 'workkit');
    expect(fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink(), `the address is a symlink, got: ${res.stderr}`).toBeTruthy();
    expect(fs.realpathSync(link), 'and it resolves to the cached engine').toBe(fs.realpathSync(copy));
    cleanup(real); cleanup(path.dirname(claude));
  });

  // A clone is the machine engine its owner chose; a plugin install beside it
  // must not take the address from under it.
  test('a clone keeps the address over a cache copy', () => {
    const { claude } = claudeHomeWith();
    const cloneRoot = mkTmp('wf-std-');
    const clone = path.join(cloneRoot, 'workflow');
    fs.cpSync(WORKFLOW_DIR, clone, { recursive: true });
    mkOriginRepo(cloneRoot, 'https://github.com/owner/workkit.git');
    fs.symlinkSync(clone, path.join(claude, 'workkit'));
    const copy = mkPluginCopy(path.join(claude, 'plugins', 'cache', 'workkit', 'workkit', '0.0.0'));
    const res = engineLinkFrom(copy, claude);
    expect(res.status, `the step runs: ${res.stderr}`).toBe(0);
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'the address still resolves to the clone').toBe(fs.realpathSync(clone));
    expect(!(res.stdout + res.stderr).includes('engine:'), `and nothing is said about it, got: ${res.stderr}`).toBeTruthy();
    cleanup(claude); cleanup(cloneRoot);
  });

  test('the same copy outside the plugin cache leaves the address alone, silently', () => {
    const { claude } = claudeHomeWith();
    const copy = mkPluginCopy(path.join(mkTmp('wf-std-'), 'workkit', 'workkit', '0.0.0'));
    const res = engineLinkFrom(copy, claude);
    expect(res.status, `the step runs: ${res.stderr}`).toBe(0);
    expect(!fs.existsSync(path.join(claude, 'workkit')), 'a manifest alone does not make a copy the machine engine').toBeTruthy();
    expect(!(res.stdout + res.stderr).includes('engine:'), `and says nothing: a skip, not a fault, got: ${res.stderr}`).toBeTruthy();
    cleanup(claude);
  });
});
