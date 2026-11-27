// Tests for workflow/workkit/kit.js, the one context every step of the command
// takes: the fields kitOf builds from a fixed env and platform, asked in a node
// of its own so this process's env never answers, an override deep-merged, and
// the kit found through a linked engine folder as the command finds it.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, start, until,
} = require('../../lib/harness');
const {
  SYSTEM_PATH, nodeHomeEnv, jsPath, samePath, skipWithoutCaughtSignal,
} = require('../../lib/platform');
const { kitUnder } = require('../../lib/kit-under');
const { WORKFLOW_DIR } = require('./helpers');

const REAL_ROOT = fs.realpathSync(path.dirname(WORKFLOW_DIR));
const REAL_ENGINE = path.join(REAL_ROOT, 'workflow');

/** kitOf(over) for each of <overs>, in one node whose whole env is <env>. */
const kitsUnder = (env, ...overs) => kitUnder(env, '../workkit/kit.js', 'kitOf', overs.map((over) => [over]));

const same = (actual, wanted, what) => {
  expect(samePath(String(actual), wanted, process.platform), `${what}: ${actual} names ${wanted}`).toBe(true);
};

describe('kitOf: the fields of a fixed env', () => {
  test('the home and the addresses under it; with no WORKFLOW_CLAUDE_HOME the Claude home is <home>/.claude', () => {
    const home = mkTmp('wk-kit-home-');
    const [kit] = kitsUnder({ HOME: home, PATH: SYSTEM_PATH }, { platform: 'linux' });
    expect(kit.platform, 'the platform given').toBe('linux');
    same(kit.home, home, 'home');
    same(kit.binDir, `${home}/.local/bin`, 'binDir');
    same(kit.binLink, `${home}/.local/bin/workkit`, 'binLink');
    same(kit.cmdLink, `${home}/.local/bin/workkit.cmd`, 'cmdLink');
    same(kit.ghShimLink, `${home}/.local/bin/gh`, 'ghShimLink');
    same(kit.claudeHome, `${home}/.claude`, 'claudeHome');
    same(kit.engineLink, `${home}/.claude/workkit`, 'engineLink');
    expect(kit.interactive, 'stdin is no terminal here').toBe(false);
  });

  test('WORKFLOW_CLAUDE_HOME is the Claude home, and the engine link sits in it', () => {
    const home = mkTmp('wk-kit-home-');
    const claude = mkTmp('wk-kit-claude-');
    const [kit] = kitsUnder({ HOME: home, PATH: SYSTEM_PATH, WORKFLOW_CLAUDE_HOME: claude }, {});
    same(kit.claudeHome, claude, 'claudeHome');
    same(kit.engineLink, `${claude}/workkit`, 'engineLink');
    same(kit.binLink, `${home}/.local/bin/workkit`, 'binLink, still under the home');
  });

  test('the two waits: 10 and 180 seconds by default, WORKKIT_GH_TIMEOUT and WORKKIT_PAGES_WAIT when set', () => {
    const home = mkTmp('wk-kit-home-');
    const [plain] = kitsUnder({ HOME: home, PATH: SYSTEM_PATH }, {});
    expect(plain.secrets.timeout, 'the gh timeout by default').toBe(10);
    expect(plain.pagesWait, 'the Pages wait by default').toBe(180);
    const [set] = kitsUnder({
      HOME: home, PATH: SYSTEM_PATH, WORKKIT_GH_TIMEOUT: '3', WORKKIT_PAGES_WAIT: '7',
    }, {});
    expect(set.secrets.timeout, 'WORKKIT_GH_TIMEOUT').toBe(3);
    expect(set.pagesWait, 'WORKKIT_PAGES_WAIT').toBe(7);
  });

  test('the Pages wait: 0 is kept, a junk, negative or blank WORKKIT_PAGES_WAIT is 180', () => {
    const home = mkTmp('wk-kit-home-');
    const waits = ['0', 'soon', '-5', ' '].map((wait) => kitsUnder({ HOME: home, PATH: SYSTEM_PATH, WORKKIT_PAGES_WAIT: wait }, {})[0].pagesWait);
    expect(waits, '0 skips at once; junk, a negative and a blank wait the default').toEqual([0, 180, 180, 180]);
  });

  test('the names the steps share: the plugin, the daily job and the two secrets', () => {
    const [kit] = kitsUnder({ HOME: mkTmp('wk-kit-home-'), PATH: SYSTEM_PATH }, {});
    expect(kit.PLUGIN_ID).toBe('workkit@workkit');
    expect(kit.DAILY_LABEL).toBe('com.workkit.claude-daily');
    expect(kit.secrets).toMatchObject({ claude: 'CLAUDE_CODE_OAUTH_TOKEN', home: 'WORKKIT_GITHUB_TOKEN', maxAgeDays: 330 });
  });

  test('an override is deep-merged: the field given wins and its siblings stay', () => {
    const home = mkTmp('wk-kit-home-');
    const other = mkTmp('wk-kit-other-');
    const [kit] = kitsUnder({ HOME: home, PATH: SYSTEM_PATH }, {
      env: { HOME: other }, secrets: { home: 'GITHUB_TOKEN' }, files: { entry: '/x/program.js' }, interactive: true,
    });
    same(kit.home, other, 'the home of the env given');
    same(kit.binLink, `${other}/.local/bin/workkit`, 'and the addresses under it');
    expect(kit.secrets, 'the secret name given, its siblings kept').toMatchObject({
      claude: 'CLAUDE_CODE_OAUTH_TOKEN', home: 'GITHUB_TOKEN', maxAgeDays: 330,
    });
    expect(kit.secrets.timeout, 'the gh wait kept').toBe(10);
    expect(kit.files.entry, 'the entry given').toBe('/x/program.js');
    same(kit.files.installer, path.join(REAL_ROOT, 'jobs', 'install.js'), 'the installer kept');
    expect(kit.interactive, 'the terminal answer given').toBe(true);
  });
});

describe('nodeRun: Ctrl-C during a program', { skip: skipWithoutCaughtSignal() }, () => {
  /**
   * A caller of nodeRun around a held program, at the head of its own process
   * group: it prints `after <code>` once nodeRun answers. The program says ready,
   * then holds; with <catches> it ends 0 on SIGINT, else SIGINT ends it.
   */
  const startCaller = (catches) => {
    const dir = mkTmp('wk-kit-int-');
    const program = path.join(dir, 'program.js');
    fs.writeFileSync(program, [
      "const fs = require('fs');",
      ...(catches ? ["process.on('SIGINT', () => process.exit(0));"] : []),
      "fs.writeSync(1, 'ready\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const caller = path.join(dir, 'caller.js');
    fs.writeFileSync(caller, [
      "const fs = require('fs');",
      `const { kitOf, nodeRun } = require(${jsPath(path.join(WORKFLOW_DIR, 'workkit', 'kit.js'))});`,
      `Promise.resolve(nodeRun(kitOf({}), ${jsPath(program)}, [])).then((code) => fs.writeSync(1, \`after \${code}\\n\`));`,
    ].join('\n'));
    return start(process.execPath, [caller], { env: nodeHomeEnv(mkTmp('wk-kit-int-home-'), { PATH: SYSTEM_PATH }), detached: true });
  };

  /** SIGINT to <call>'s whole group once its program said ready; what the call ended with. */
  const interrupt = async (call) => {
    try {
      expect(await until(() => call.stdout().includes('ready\n')), `the program started, got: ${call.output()}`).toBe(true);
      process.kill(-call.pid, 'SIGINT');
      return await call.done;
    } finally {
      await call.end('SIGKILL');
    }
  };

  test('a program SIGINT ends: the caller does not go on, and ends by that INT', async () => {
    const call = startCaller(false);
    const end = await interrupt(call);
    expect(end.signal === 'SIGINT' || end.status === 130, `a death by SIGINT or 130, got: ${JSON.stringify(end)} ${call.output()}`).toBe(true);
    expect(call.stdout().includes('after'), `the caller printed nothing after the call, got: ${call.stdout()}`).toBe(false);
  });

  test('a program that catches SIGINT and ends 0 by itself: the caller goes on with 0', async () => {
    const call = startCaller(true);
    const end = await interrupt(call);
    expect(end.status, `exit 0, got: ${call.output()}`).toBe(0);
    expect(call.stdout(), 'the caller went on past the call').toBe('ready\nafter 0\n');
  });
});

describe('workkit.js through a linked engine folder', () => {
  // The engine as ~/.claude/workkit reaches it: a link to the kit's workflow/.
  const linkedEngine = () => {
    const link = path.join(mkTmp('wk-kit-link-'), 'workkit');
    fs.symlinkSync(WORKFLOW_DIR, link, 'junction');
    return link;
  };

  test('the entry started through the link runs help and exits 0', () => {
    const link = linkedEngine();
    const res = run(process.execPath, [path.join(link, 'workkit.js'), 'help'], {
      env: { HOME: mkTmp('wk-kit-home-'), PATH: SYSTEM_PATH },
    });
    expect(res.status, `exit 0, got: ${res.output}`).toBe(0);
    expect(res.stdout.startsWith('workkit: the issue workflow, one command.\n'), `the help, got: ${res.output}`).toBe(true);
  });

  test('kitOf loaded through the link names the real kit\'s installer, tower and core program', () => {
    const link = linkedEngine();
    const res = run(process.execPath, ['-e', [
      `const kit = require(${jsPath(path.join(link, 'workkit', 'kit.js'))}).kitOf({});`,
      'process.stdout.write(JSON.stringify({ engine: kit.engine, root: kit.root, files: kit.files }));',
    ].join('\n')], { env: { HOME: mkTmp('wk-kit-home-'), PATH: SYSTEM_PATH } });
    expect(res.status, `kitOf answered, stderr: ${res.stderr}`).toBe(0);
    const kit = JSON.parse(res.stdout);
    same(kit.engine, REAL_ENGINE, 'engine');
    same(kit.root, REAL_ROOT, 'root');
    same(kit.files.installer, path.join(REAL_ROOT, 'jobs', 'install.js'), 'installer');
    same(kit.files.tower, path.join(REAL_ROOT, 'tower', 'start.js'), 'tower');
    same(kit.files.coreBin, path.join(REAL_ROOT, 'packages', 'core', 'bin', 'workkit.js'), 'coreBin');
  });
});
