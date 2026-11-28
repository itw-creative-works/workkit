// Tests for workflow/workkit.js: how a run is organized: titled sections,
// color only at a terminal that wants it, and the indent a title or a section
// gives every line after it, a wait line's and a question's included. Then the
// doctor's env: line under This machine. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, start, run, until, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, nodeHomeEnv, jsPath, which,
} = require('../../lib/platform');
const { framesIn } = require('../../lib/spin-call');
const { mkOriginRepo } = require('../../lib/git-repo');
const {
  INSTALL_FIX, repoRoute, writeLogin, useTokenService, startServer, startService, attentionCount, doctorWarnings,
} = require('../../lib/identity');
const {
  WORKFLOW_DIR, cleanup, mkWorld, runCli, mkKit, SLUG, mkHomeWorld, mkRepo, mkSetupKit, rosterRepo, signInEnv, inNode, lines,
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
      `const { spawnSync } = require(${jsPath(path.join(WORKFLOW_DIR, 'lib', 'run.js'))});`,
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

describe('workkit doctor: a home variable only Git Bash can read is said under This machine', {
  skip: !IS_WINDOWS && 'off Windows every program reads a home by its spelling',
}, () => {
  // Git Bash reads /home under its own install folder; it rides no temp mount, which this world moved.
  const SHELL_ONLY = '/home/wk-doctor/.claude';

  test('WORKFLOW_CLAUDE_HOME in a spelling only Git Bash reads is one env: line under This machine, counted; the same folder as a drive path is none', () => {
    const world = mkWorld();
    const asked = run(which('cygpath', SYSTEM_PATH), ['-m', SHELL_ONLY], { env: world.env });
    expect(asked.status, `cygpath named the folder's drive path, got: ${asked.output}`).toBe(0);
    const drive = asked.stdout.trim();
    // Every line on stderr, so a warning reads in its order among the section titles.
    const doctorWith = (folder) => runCli(world, ['doctor'], { env: { WORKFLOW_CLAUDE_HOME: folder, WK_LOG_STDERR: '1' } });
    const shell = doctorWith(SHELL_ONLY);
    const native = doctorWith(drive);
    cleanup(world.root);

    const said = lines(shell.err);
    const line = said.indexOf(`⚠ env: WORKFLOW_CLAUDE_HOME (${SHELL_ONLY}) is a path only Git Bash can read, so the hooks and the commands read different folders; set it as a drive path (C:/...)`);
    const machine = said.indexOf('💻 This machine');
    const next = said.indexOf('🏠 Home repo');
    expect(machine >= 0 && line > machine && line < next, `the env: line under This machine, got: ${shell.said}`).toBe(true);
    expect(attentionCount(shell.said), `the closing count holds it, got: ${shell.said}`).toBe(attentionCount(native.said) + 1);
    expect(doctorWarnings(native).some((l) => l.trim().startsWith('⚠ env:')), `the drive spelling says no env: line, got: ${native.said}`).toBe(false);
  });
});
