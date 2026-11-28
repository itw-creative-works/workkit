// Tests for workflow/workkit.js: how a run is organized: titled sections,
// color only at a terminal that wants it, and the indent a title or a section
// gives every line after it, a wait line's and a question's included. Then the
// doctor's env: line under This machine. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, before, after, mkTmp, start, until, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NO_RC, nodeHomeEnv, jsPath, gitPath, spawnBash, joinPath, basePathWithout, stubToolJs, RUN_JS,
} = require('../../lib/platform');
const { framesIn } = require('../../lib/spin-call');
const { mkOriginRepo } = require('../../lib/git-repo');
const {
  INSTALL_FIX, repoRoute, writeLogin, useTokenService, startServer, startService, attentionCount, doctorWarnings,
} = require('../../lib/identity');
const {
  WORKFLOW_DIR, CLI, cleanup, mkWorld, runCli, mkKit, SLUG, mkHomeWorld, mkRepo, mkSetupKit, rosterRepo, signInEnv, inNode, npmrcEnv, lines,
} = require('./helpers');

describe('workkit: how a run is organized (issue #90)', () => {
  // The escape byte every color code starts with. Nothing this command prints
  // to a pipe may contain one: the standards hook relays `update --auto` into a
  // session's context, and the log files keep the rest.
  const ESCAPE = '\u001b';
  // Where a section title sits in a transcript: a blank line, then the title
  // with its emoji and nothing else.
  const sectionAt = (text, title) => text.search(new RegExp(`\n\n${title}\n`));
  const SETUP_SECTIONS = ['💻 This machine', '🏠 Home repo', '🔑 Cloud brief secrets', '🪪 Identity', '🌐 Dashboard site',
    '📁 This repo'];
  const DOCTOR_SECTIONS = ['💻 This machine', '🏠 Home repo', '🔑 Cloud brief secrets', '📁 This repo'];

  test('a piped run is grouped into titled sections and carries no color', () => {
    const world = mkWorld();
    // A real TERM, so escape-free output here is the tty gate's doing, with no
    // TERM at all bash reports `dumb` and the dumb-TERM check would pass this
    // test with the tty gate deleted.
    const { out } = runCli(world, ['doctor'], { env: { TERM: 'xterm-256color' } });
    expect(!out.includes(ESCAPE), `no escape sequence reaches a pipe, got: ${JSON.stringify(out)}`).toBeTruthy();
    for (const title of DOCTOR_SECTIONS) {
      expect(sectionAt(out, title) > -1, `"${title}" is a section, with a blank line before it, got: ${out}`).toBeTruthy();
    }
    cleanup(world.root);
  });

  test('setup names its sections in the order it runs them', () => {
    const world = mkHomeWorld({ secrets: [] });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    let at = -1;
    for (const title of SETUP_SECTIONS) {
      const next = sectionAt(out, title);
      expect(next > at, `"${title}" comes after the section before it, got: ${out}`).toBeTruthy();
      at = next;
    }
    cleanup(world.root); cleanup(kit);
  });

  // The terminal this suite cannot be: the seam stands in for the tty, and TERM
  // is named because a shell handed no environment reports `dumb`.
  const AT_A_TERMINAL = { WORKKIT_COLOR: '1', TERM: 'xterm-256color' };

  test('at a terminal the section headers are styled and the glyphs colored', () => {
    const world = mkWorld();
    const { out, err } = runCli(world, ['doctor'], { env: AT_A_TERMINAL });
    // The line shape, in color: a section title in bold cyan, one
    // blank line above it, its emoji riding along.
    expect(out.includes(`\n\n${ESCAPE}[1m${ESCAPE}[0;36m💻 This machine${ESCAPE}[0m\n`),
      `the header is bold and colored, got: ${JSON.stringify(out)}`).toBeTruthy();
    // A warning wears its color on the glyph, the task and the message alike.
    expect(err.includes(`${ESCAPE}[0;33m⚠${ESCAPE}[0m`), `a warning's glyph is yellow, got: ${JSON.stringify(err)}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a machine that asked for no color gets none, however it asked', () => {
    // Each no is final, even against the seam that asked for color, because a
    // machine saying NO_COLOR is answering for every tool on it.
    for (const [why, env] of [
      ['NO_COLOR is set', { ...AT_A_TERMINAL, NO_COLOR: '1' }],
      ['the terminal is dumb', { ...AT_A_TERMINAL, TERM: 'dumb' }],
      ['color was switched off', { ...AT_A_TERMINAL, WORKKIT_COLOR: '0' }],
    ]) {
      const world = mkWorld();
      const { out } = runCli(world, ['doctor'], { env });
      expect(!out.includes(ESCAPE), `${why}: nothing is styled, got: ${JSON.stringify(out)}`).toBeTruthy();
      expect(sectionAt(out, '💻 This machine') > -1, `${why}: and the grouping is still there, got: ${out}`).toBeTruthy();
      cleanup(world.root);
    }
  });

  test('update --auto gains no header, no blank line, and no color', () => {
    // The session-start injection stays terse: whatever a human's run looks
    // like, the automatic one is the lines it changed and nothing around them.
    for (const [where, env] of [['a session start', {}], ['a terminal', AT_A_TERMINAL]]) {
      const world = mkWorld();
      fs.mkdirSync(world.localBin, { recursive: true });
      const { out } = runCli(world, ['update', '--auto'], { env });
      expect(out.includes('command:'), `${where}: it still reports what it did, got: ${out}`).toBeTruthy();
      if (env !== AT_A_TERMINAL) expect(!out.includes(ESCAPE), `${where}: and says it plainly, got: ${JSON.stringify(out)}`).toBeTruthy();
      expect(!/\n\s*\n/.test(out), `no blank line, got: ${JSON.stringify(out)}`).toBeTruthy();
      for (const title of SETUP_SECTIONS) {
        expect(!out.includes(title), `no "${title}" header, got: ${out}`).toBeTruthy();
      }
      expect(!out.includes('workkit update in'), `and no title line, got: ${out}`).toBeTruthy();
      cleanup(world.root);
    }
  });
});

describe('workkit: a wait line or a question under a title carries its indent', () => {
  test('the doctor\'s token-service wait under This repo is its own line at the section\'s indent', async () => {
    // A signed-in machine in an opted-in repo on the roster: the doctor asks the
    // token service about acme/rostered, behind the one wait line a pipe gets.
    const world = mkWorld();
    const { kit, script } = mkKit('owner/kit');
    const repo = mkRepo({ optIn: true });
    rosterRepo(world, repo, 'acme/rostered', { script, env: signInEnv(world, { node: false }) });
    writeLogin(world.home, { token: 'ghu_doctoruser', login: 'octocat' });
    const service = await startService(200, { token: 'ghs_probe', expires_at: '2099-01-01T00:00:00Z' });
    try {
      useTokenService(world.home, `${service.url}/token`);
      const { err, said } = runCli(world, ['doctor'], { script, cwd: repo, env: signInEnv(world) });
      expect(err.split('\n').includes('  ⏳ asking the token service whether workkit-agent[bot] is installed on acme/rostered...'),
        `the wait line at the section's two spaces, got: ${said}`).toBe(true);
    } finally {
      await service.close();
      cleanup(world.root); cleanup(kit); cleanup(repo);
    }
  });

  test('setup --bot at a keyboard: after its title, the install poll\'s keys and its wait line sit at the title\'s indent', async () => {
    // acme lacks the App throughout: y answers the install question, s skips the poll.
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const repo = mkRepo({ optIn: true });
    const server = await startServer([
      { method: 'POST', url: '/token', answers: [{ status: 412, body: JSON.stringify({ error: 'not installed', fix: INSTALL_FIX }) }] },
      repoRoute('acme/rostered', 'acme/rostered', 4242),
    ], world.root);
    try {
      mkOriginRepo(repo, 'https://github.com/acme/rostered.git');
      writeLogin(world.home, { token: 'ghu_setupuser', login: 'octocat' });
      useTokenService(world.home, `${server.url}/token`);
      const res = inNode(world, {
        engine: path.dirname(script),
        file: 'workkit/setup.js',
        fn: 'setup',
        args: ['--bot'],
        kit: { interactive: true },
        cwd: repo,
        input: 'y\ns',
        env: signInEnv(world, { extra: { GITHUB_API_URL: server.url } }),
      });
      const lines = res.err.split('\n');
      expect(lines.includes('  (enter)=check now, (s)=skip'), `the poll's keys at the title's two spaces, got: ${res.said}`).toBe(true);
      expect(lines.includes('  ⏳ waiting for workkit-agent[bot] to be installed on acme...'), `and its wait line, got: ${res.said}`).toBe(true);
    } finally {
      await server.close();
      cleanup(world.root); cleanup(kit); cleanup(repo);
    }
  });

  test('a wait line\'s moving frames, forced on under a title, are drawn at the title\'s indent', async () => {
    // A caller titles its run, then spins around a child held until the case saw a frame.
    const dir = mkTmp('wk-title-frames-');
    const release = path.join(dir, 'release');
    const caller = path.join(dir, 'caller.js');
    const message = 'reading the roster';
    fs.writeFileSync(caller, [
      `const { title } = require(${jsPath(path.join(WORKFLOW_DIR, 'lib', 'voice.js'))});`,
      `const { spin } = require(${jsPath(path.join(WORKFLOW_DIR, 'lib', 'spin.js'))});`,
      `const { spawnSync } = require(${jsPath(RUN_JS)});`,
      'const hold = [',
      '  "const fs = require(\'fs\');",',
      '  "const giveUp = setTimeout(() => process.exit(3), Number(process.argv[2]));",',
      '  "const held = setInterval(() => { if (fs.existsSync(process.argv[1])) { clearInterval(held); clearTimeout(giveUp); } }, 20);",',
      "].join('\\n');",
      "title('🧪 a titled run');",
      `spin(${JSON.stringify(message)}, () => spawnSync(process.execPath, ['-e', hold, ${jsPath(release)}, '${SPAWN_DEADLINE}'], { stdio: 'ignore' }));`,
    ].join('\n'));
    const call = start(process.execPath, [caller], { env: nodeHomeEnv(dir, { PATH: SYSTEM_PATH, WORKKIT_SPIN: '1' }) });
    try {
      expect(await until(() => framesIn(call.stderr(), message).length > 0), `a frame was drawn, got: ${JSON.stringify(call.stderr())}`).toBe(true);
    } finally {
      fs.writeFileSync(release, '');
      await call.done;
    }
    const frames = framesIn(call.stderr(), message);
    expect(frames.length > 0 && frames.every((f) => /^ {2}\S/.test(f)), `every frame opens at the title's two spaces, got: ${JSON.stringify(frames)}`).toBe(true);
  });
});

// Git Bash reads /home under its own install folder; it rides no temp mount, which this world moved.
const SHELL_ONLY = '/home/wk-doctor/.claude';
// Whether a doctor run logged to stderr says WORKFLOW_CLAUDE_HOME's env: line for `value` under This machine.
const envLineUnderMachine = (res, value) => {
  const said = lines(res.err);
  const line = said.indexOf(`⚠ env: WORKFLOW_CLAUDE_HOME (${value}) is a path only Git Bash can read, so the hooks and the commands read different folders; set it as a drive path (C:/...)`);
  const machine = said.indexOf('💻 This machine');
  return machine >= 0 && line > machine && line < said.indexOf('🏠 Home repo');
};
const saysEnvLine = (res) => doctorWarnings(res).some((l) => l.trim().startsWith('⚠ env:'));

describe('workkit doctor: a home variable only Git Bash can read is said under This machine', {
  skip: !IS_WINDOWS && 'off Windows every program reads a home by its spelling',
}, () => {
  test('WORKFLOW_CLAUDE_HOME in a spelling only Git Bash reads is one env: line under This machine, counted; a drive path is none', () => {
    const world = mkWorld();
    // A drive path outside Git Bash's install folder: the world's own Claude home.
    const drive = world.claudeHome;
    // Every line on stderr, so a warning reads in its order among the section titles.
    const doctorWith = (folder) => runCli(world, ['doctor'], { env: { WORKFLOW_CLAUDE_HOME: folder, WK_LOG_STDERR: '1' } });
    const shell = doctorWith(SHELL_ONLY);
    const native = doctorWith(drive);
    cleanup(world.root);

    expect(envLineUnderMachine(shell, SHELL_ONLY), `the env: line under This machine, got: ${shell.said}`).toBe(true);
    expect(attentionCount(shell.said), `the closing count holds it, got: ${shell.said}`).toBe(attentionCount(native.said) + 1);
    expect(saysEnvLine(native), `the drive spelling says no env: line, got: ${native.said}`).toBe(false);
  });

  describe('started through Git Bash, which rewrites the value before node reads it', () => {
    let world;
    let shell;
    let drive;
    // bash holds the folder in its own environment and starts node, so the value node reads is Git Bash's rewrite.
    const doctorFromBash = (folder) => {
      const res = spawnBash([...NO_RC, '-c', `WORKFLOW_CLAUDE_HOME='${folder}' "$0" "$1" doctor`, gitPath(process.execPath), gitPath(CLI)], {
        cwd: world.root, env: { ...world.env, WK_LOG_STDERR: '1' }, input: '', encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      expect(res.status !== null, `the doctor finished (no timeout, no signal): ${res.error || ''}`).toBe(true);
      return { err: res.stderr || '', said: `${res.stdout || ''}${res.stderr || ''}` };
    };

    before(() => {
      world = mkWorld();
      shell = doctorFromBash(SHELL_ONLY);
      // A drive path outside Git Bash's install folder: the world's own Claude home.
      drive = doctorFromBash(gitPath(world.claudeHome));
    });
    after(() => cleanup(world.root));

    test('WORKFLOW_CLAUDE_HOME set to a /home path in bash is one env: line under This machine, counted', () => {
      expect(envLineUnderMachine(shell, SHELL_ONLY), `the env: line under This machine, got: ${shell.said}`).toBe(true);
      expect(attentionCount(shell.said), `the closing count holds it, got: ${shell.said}`).toBe(attentionCount(drive.said) + 1);
    });

    test('WORKFLOW_CLAUDE_HOME set to a drive path in bash is no env: line', () => {
      expect(saysEnvLine(drive), `no env: line, got: ${drive.said}`).toBe(false);
    });
  });
});

describe('workkit doctor on a Windows platform: the Git Bash root as cygpath answers it', () => {
  // The drive path a node started from Git Bash reads for SHELL_ONLY.
  const REWRITTEN = `C:/Program Files/Git${SHELL_ONLY}`;
  let world;
  let noRoot;
  let rooted;
  let unset;
  const doctorOnWindows = (pathDir, env = {}) => inNode(world, {
    file: 'workkit/doctor.js', fn: 'doctor', kit: { platform: 'win32' },
    env: { ...npmrcEnv(world), PATH: joinPath(world.bin, pathDir), WK_LOG_STDERR: '1', ...env },
  });

  before(() => {
    world = mkWorld();
    const bare = basePathWithout(world.root, 'cygpath');
    const fake = path.join(world.root, 'cygpath-root');
    fs.mkdirSync(fake);
    // Git Bash's / as cygpath -m names it, closing slash and all; any other ask is refused out loud.
    stubToolJs(fake, 'cygpath', [
      'const args = process.argv.slice(2);',
      "if (args.length === 2 && args[0] === '-m' && args[1] === '/') process.stdout.write('C:/Program Files/Git/\\n');",
      "else { process.stderr.write(`cygpath fake: no answer for ${args.join(' ')}\\n`); process.exitCode = 1; }",
    ].join('\n'));
    unset = doctorOnWindows(bare);
    noRoot = doctorOnWindows(bare, { WORKFLOW_CLAUDE_HOME: REWRITTEN });
    rooted = doctorOnWindows(joinPath(fake, bare), { WORKFLOW_CLAUDE_HOME: REWRITTEN });
  });
  after(() => cleanup(world.root));

  test('no cygpath on PATH: no root, so no env: line, and the doctor ends as it does with the world\'s own Claude home', () => {
    // Only this variable's line: on a Mac the world's own HOME and WORKFLOW_HOME are POSIX, named in every run here.
    const named = doctorWarnings(noRoot).some((l) => l.trim().startsWith('⚠ env: WORKFLOW_CLAUDE_HOME'));
    expect(named, `no env: line for WORKFLOW_CLAUDE_HOME, got: ${noRoot.said}`).toBe(false);
    // Another Claude home is other folders to check, so the count may differ; the end may not.
    expect(noRoot.code, `the exit code it has with the world's home, got: ${noRoot.said}`).toBe(unset.code);
    expect(attentionCount(noRoot.said) > 0, `the doctor reached its closing count, got: ${noRoot.said}`).toBe(true);
  });

  test('a cygpath naming the root: the env: line under This machine in Git Bash\'s spelling, counted', () => {
    expect(envLineUnderMachine(rooted, SHELL_ONLY), `the env: line under This machine, got: ${rooted.said}`).toBe(true);
    expect(attentionCount(rooted.said), `the closing count holds it, got: ${rooted.said}`).toBe(attentionCount(noRoot.said) + 1);
  });
});
