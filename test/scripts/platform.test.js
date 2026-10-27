// Tests for workflow/lib/platform.sh: the engine's platform seam, the one home of
// the spellings macOS, Windows (Git Bash) and Linux disagree about. The engine and
// the hook layer both source it, so it has its own suite; the Windows branch is
// driven by an inherited OSTYPE plus a `cygpath` on PATH.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, testUnless, summary, selfRun, mkTmp, until, alive, start, endTree, SPAWN_DEADLINE } = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, cygpathStub,
  stubTool, pathWith, systemPathWith,
} = require('../lib/platform');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const PLATFORM = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));
const DETACH = path.join(__dirname, '..', '..', 'workflow', 'lib', 'detach.js');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source platform.sh and run one line of shell in it, the way every caller does. */
const inPlatform = (script, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(PLATFORM)}\n${script}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** A PATH directory holding the seam's cygpath, the Windows branch's one tool. */
const cygpathWorld = () => {
  const dir = mkTmp('wf-platform-');
  cygpathStub(dir);
  return dir;
};

/**
 * A PATH directory holding a `netstat` that prints what a real Windows
 * `netstat -ano` prints for one port, CRLF ends and all: the rows the branch
 * has to keep and every near miss it has to drop. Written as a stub so the
 * Windows lookup is answerable off a Windows machine, the way `cygpathWorld`
 * above answers the Windows path spelling.
 */
const netstatWorld = () => {
  const dir = mkTmp('wf-platform-');
  stubTool(dir, 'netstat', [
    '#!/bin/bash',
    'printf "%s\\r\\n" \\',
    '  "" \\',
    '  "Active Connections" \\',
    '  "" \\',
    '  "  Proto  Local Address          Foreign Address        State           PID" \\',
    '  "  TCP    0.0.0.0:8693           0.0.0.0:0              LISTENING       4242" \\',
    '  "  TCP    [::]:8693              [::]:0                 LISTENING       4242" \\',
    '  "  TCP    127.0.0.1:18693        0.0.0.0:0              LISTENING       5151" \\',
    '  "  TCP    0.0.0.0:86930          0.0.0.0:0              LISTENING       5252" \\',
    '  "  TCP    10.0.0.5:51300         93.184.216.34:8693     ESTABLISHED     5353" \\',
    '  "  UDP    0.0.0.0:8693           *:*                                    5454"',
  ]);
  return dir;
};

// The port questions run on this machine's own PATH rather than the system one
// every other case here uses: the tools they ask (`lsof`, and on Windows
// `netstat` in system32 and the `kill.exe` beside bash) are not one directory,
// and a real run of the tower has the whole PATH anyway.
const PORT_TOOL_PATH = { PATH: process.env.PATH };

/**
 * A child process listening on a free port, as the harness `start()` handle, and
 * the port it took: the shape a port takeover finds. Written with process.stdout rather than console.log,
 * which paints a number once FORCE_COLOR is set and would hand the case a port
 * wrapped in escapes.
 *
 * `ignoreTerm` gives the child a SIGTERM handler that does nothing, which is
 * the listener the tower's escalation exists for: it rides out the polite
 * signal and only the forced one ends it.
 * @param {boolean} [ignoreTerm]
 */
const listener = (ignoreTerm = false) => new Promise((resolve, reject) => {
  const handle = start(process.execPath, ['-e', [
    ignoreTerm ? "process.on('SIGTERM',()=>{});" : '',
    "const s=require('net').createServer();",
    "s.listen(0,'127.0.0.1',()=>process.stdout.write(`${s.address().port}\\n`));",
    'setInterval(()=>{},1000);',
  ].join('')]);
  handle.done.catch(reject);
  handle.child.stdout.on('data', () => {
    if (handle.stdout().includes('\n')) resolve({ ...handle, port: Number(handle.stdout().trim()) });
  });
});

/** Whether the child is gone within the deadline. */
const ended = (child, ms = SPAWN_DEADLINE) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(true); return; }
  const timer = setTimeout(() => resolve(false), ms);
  child.on('exit', () => { clearTimeout(timer); resolve(true); });
});

const cases = async () => {
  group('platform.sh: wk_git_path');

  await test('on the Windows branch a path is spelled the way git spells it', () => {
    const dir = cygpathWorld();
    const { out } = inPlatform('wk_git_path /c/Users/x', {
      OSTYPE: 'msys', PATH: pathWith(dir),
    });
    assertEq(out, 'C:/Users/x', `the mixed form, got: ${JSON.stringify(out)}`);
    cleanup(dir);
  });

  await test('cygwin takes the same branch as msys', () => {
    const dir = cygpathWorld();
    const { out } = inPlatform('wk_git_path /c/Users/x', {
      OSTYPE: 'cygwin', PATH: pathWith(dir),
    });
    assertEq(out, 'C:/Users/x', `one branch for both runtimes, got: ${JSON.stringify(out)}`);
    cleanup(dir);
  });

  await test('the answer carries no trailing newline, so a key is the path alone', () => {
    const dir = cygpathWorld();
    const { out } = inPlatform('wk_git_path /c/Users/x; printf "|"', {
      OSTYPE: 'msys', PATH: pathWith(dir),
    });
    assertEq(out, 'C:/Users/x|', `nothing after the path, got: ${JSON.stringify(out)}`);
    cleanup(dir);
  });

  await test('this machine answers for itself: unchanged off Windows, git\'s spelling on it', () => {
    // No OSTYPE override and no stub: the shell's own answer, which is the one
    // every real run of the engine gets. The drive-mount spelling is the input
    // because it is the one that differs: off Windows it comes back byte for
    // byte, which is the identity this seam promises there.
    const { out } = inPlatform('wk_git_path /c/Users/x/repo; printf "|"');
    const expected = IS_WINDOWS ? 'C:/Users/x/repo|' : '/c/Users/x/repo|';
    assertEq(out, expected, `the platform's own spelling, got: ${JSON.stringify(out)}`);
  });

  await test('a linux OSTYPE is the identity too, with no cygpath anywhere near it', () => {
    const { out } = inPlatform('wk_git_path /home/x/repo; printf "|"', { OSTYPE: 'linux-gnu' });
    assertEq(out, '/home/x/repo|', `untouched, got: ${JSON.stringify(out)}`);
  });

  await test('sourcing the file runs nothing and sets nothing', () => {
    const { out } = inPlatform('printf "sourced"');
    assertEq(out, 'sourced', `only what the caller asked for, got: ${JSON.stringify(out)}`);
  });

  group('platform.sh: wk_user_dir');

  await test('wk_user_dir: WORKFLOW_HOME wins, else ~/.workkit, and an unset HOME never aborts set -u', () => {
    assertEq(inPlatform('wk_user_dir', { WORKFLOW_HOME: '/w/kit', HOME: '/h' }).out, '/w/kit\n', 'the override');
    assertEq(inPlatform('wk_user_dir', { HOME: '/h' }).out, '/h/.workkit\n', 'the default');
    const bare = inPlatform('set -u; unset HOME; wk_user_dir');
    assertEq(bare.code, 0, `no unbound-variable abort: ${bare.err}`);
    assertEq(bare.out, '/.workkit\n', 'the default with no HOME');
  });

  group("platform.sh: npm's script shell");

  await test("wk_npm_script_shell: npm's value without the carriage return a Windows npm ends it with", () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'npm', ['#!/bin/bash', 'printf "C:/h/.workkit/script-shell.exe\\r\\n"']);
    const { code, out } = inPlatform('v=$(wk_npm_script_shell); printf "[%s]" "$v"', { PATH: systemPathWith(dir) });
    assertEq(code, 0, 'npm answered');
    assertEq(out, '[C:/h/.workkit/script-shell.exe]', `the value alone, got: ${JSON.stringify(out)}`);
    cleanup(dir);
  });

  await test("wk_npm_script_shell: npm's own failure comes back", () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'npm', ['#!/bin/bash', 'exit 3']);
    const { code } = inPlatform('wk_npm_script_shell', { PATH: systemPathWith(dir) });
    assertEq(code, 3, "npm's exit status, never tr's");
    cleanup(dir);
  });

  await test('wk_script_shell_exe: the executable in the machine folder, WORKFLOW_HOME first', () => {
    assertEq(inPlatform('wk_script_shell_exe', { WORKFLOW_HOME: '/w/kit', HOME: '/h' }).out,
      '/w/kit/script-shell.exe\n', 'the named machine folder');
    assertEq(inPlatform('wk_script_shell_exe', { HOME: '/h' }).out,
      '/h/.workkit/script-shell.exe\n', 'else the home one');
  });

  await test('wk_physical_path: a file named through a linked folder reads as the physical folder plus its name', () => {
    const dir = mkTmp('wf-platform-');
    const real = path.join(dir, 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'shell.sh'), '');
    // A junction on Windows, a symlink elsewhere (where the type is ignored).
    const linked = path.join(dir, 'linked');
    fs.symlinkSync(real, linked, 'junction');
    const { code, out } = inPlatform(`wk_physical_path ${JSON.stringify(`${shellPath(linked)}/shell.sh`)}`);
    assertEq(code, 0, 'the folder was entered');
    assertEq(out, `${shellPath(fs.realpathSync(real))}/shell.sh`, `the real folder, no trailing newline, got: ${JSON.stringify(out)}`);
    cleanup(dir);
  });

  // A file symlink needs a privilege Windows may not grant, so the probe asks once.
  const NO_FILE_LINK = (() => {
    const dir = mkTmp('wf-platform-');
    fs.writeFileSync(path.join(dir, 'target'), '');
    try { fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), 'file'); return ''; }
    catch (e) { return `this machine cannot make a file symlink (${e.code})`; }
    finally { cleanup(dir); }
  })();
  await testUnless(Boolean(NO_FILE_LINK), NO_FILE_LINK)("wk_physical_path: a link to a file keeps the link's own folder and name", () => {
    const dir = mkTmp('wf-platform-');
    const away = path.join(dir, 'away');
    const here = path.join(dir, 'here');
    fs.mkdirSync(away);
    fs.mkdirSync(here);
    fs.writeFileSync(path.join(away, 'target.sh'), '');
    fs.symlinkSync(path.join(away, 'target.sh'), path.join(here, 'link.sh'), 'file');
    const { code, out } = inPlatform(`wk_physical_path ${JSON.stringify(`${shellPath(here)}/link.sh`)}`);
    assertEq(code, 0, 'the folder was entered');
    assertEq(out, `${shellPath(fs.realpathSync(here))}/link.sh`, `the link's folder and name, never the target's, got: ${JSON.stringify(out)}`);
    cleanup(dir);
  });

  await test('wk_physical_path: a folder that does not exist returns non-zero and prints nothing', () => {
    const dir = mkTmp('wf-platform-');
    const { code, out, err } = inPlatform(`wk_physical_path ${JSON.stringify(`${shellPath(dir)}/missing/shell.sh`)}`);
    assert(code !== 0, `non-zero, got: ${code}`);
    assertEq(out, '', `nothing on stdout, got: ${JSON.stringify(out)}`);
    assertEq(err, '', `nothing on stderr, got: ${JSON.stringify(err)}`);
    cleanup(dir);
  });

  group('platform.sh: wk_port_pids and wk_end_pid');

  await test('a port a real listener holds answers with its pid, and a free one answers nothing', async () => {
    // A listener this process owns, so the pid the seam prints is one the case
    // already knows. Both halves of the answer are here: the pid while it
    // listens, and nothing at all once it does not, which is what the tower's
    // reclaim reads as "the port is free".
    const server = net.createServer();
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    try {
      const { out } = inPlatform(`wk_port_pids ${port}`, PORT_TOOL_PATH);
      assertEq(out.trim(), String(process.pid), `the pid holding the port, got: ${JSON.stringify(out)}`);
    } finally {
      await new Promise((resolve) => { server.close(resolve); });
    }
    const { out } = inPlatform(`wk_port_pids ${port}`, PORT_TOOL_PATH);
    assertEq(out.trim(), '', `nothing listens there now, got: ${JSON.stringify(out)}`);
  });

  await test('the Windows branch reads netstat: one pid per listener, CRLF stripped, near misses dropped', () => {
    // Windows answered off Windows: OSTYPE plus the branch's own tool on PATH.
    // The stub's rows carry every near miss: one pid on both stacks (one answer),
    // a port this one is only a suffix or a prefix of, a connection whose foreign
    // port matches, and a UDP row.
    const dir = netstatWorld();
    try {
      const { out } = inPlatform('wk_port_pids 8693', { OSTYPE: 'msys', PATH: pathWith(dir) });
      assertEq(out, '4242\n', `the one listening pid, with no carriage return on it, got: ${JSON.stringify(out)}`);
      const free = inPlatform('wk_port_pids 8694', { OSTYPE: 'msys', PATH: pathWith(dir) });
      assertEq(free.out, '', `a port nothing listens on answers nothing, got: ${JSON.stringify(free.out)}`);
      assertEq(free.code, 0, 'and answers it successfully, so a caller reads the empty answer and not a status');
    } finally {
      cleanup(dir);
    }
  });

  await test('the pid a port answered with is ended by the seam, politely and forced alike', async () => {
    // The takeover the tower runs, in its two passes, against a child since the
    // point is that it dies. The forced pass gets a child that ignores SIGTERM:
    // one that dies on the polite signal would answer the same whether `-9` was
    // carried or dropped.
    for (const signal of ['', '-9']) {
      const forced = signal === '-9';
      const { child, port, end } = await listener(forced);
      try {
        const { out } = inPlatform(`wk_port_pids ${port}`, PORT_TOOL_PATH);
        assertEq(out.trim(), String(child.pid), `the child holds the port, got: ${JSON.stringify(out)}`);
        if (forced && !IS_WINDOWS) {
          // What the escalation is for: the polite call leaves this one
          // listening. Only where a polite end exists, since Windows has none
          // for a process without a window and ends it on the first call.
          inPlatform(`wk_end_pid ${child.pid}`, PORT_TOOL_PATH);
          assertEq(await ended(child, 2000), false, 'the polite signal left the stubborn listener alive');
        }
        inPlatform(`wk_end_pid ${signal} ${child.pid}`, PORT_TOOL_PATH);
        assert(await ended(child), `${signal || 'the polite signal'} ended it`);
      } finally {
        await end('SIGKILL');
      }
    }
  });

  group('platform.sh: wk_end_run and wk_pid_alive');

  /**
   * A PATH directory whose named tools only log their argv, one log per tool,
   * so the Windows arm is answered off Windows and ends nothing real.
   */
  const loggingWorld = (...tools) => {
    const dir = mkTmp('wf-platform-');
    for (const tool of tools) stubTool(dir, tool, ['#!/bin/bash', recordArgv(path.join(dir, `${tool}.log`))]);
    return { dir, calls: (tool) => readArgv(path.join(dir, `${tool}.log`)) };
  };

  await test('the Windows arm ends the tree through taskkill, and through wk_end_pid where there is none', () => {
    // The system PATH holds no taskkill on either platform (only Git Bash's own
    // directory on Windows), so a stub is the only one either half could find.
    const both = loggingWorld('taskkill', 'kill');
    try {
      const res = inPlatform('wk_end_run 4242', { OSTYPE: 'msys', PATH: systemPathWith(both.dir) });
      assertEq(res.code, 0, `the call returns 0, stderr: ${res.err}`);
      assertEq(fmtCalls(both.calls('taskkill')), fmtCalls([['//T', '//F', '//PID', '4242']]), 'the whole tree, forced, by pid');
      assertEq(both.calls('kill').length, 0, `and nothing else: ${fmtCalls(both.calls('kill'))}`);
    } finally {
      cleanup(both.dir);
    }
    const bare = loggingWorld('kill');
    try {
      const res = inPlatform('wk_end_run 4242', { OSTYPE: 'msys', PATH: systemPathWith(bare.dir) });
      assertEq(res.code, 0, `the call returns 0, stderr: ${res.err}`);
      assertEq(fmtCalls(bare.calls('kill')), fmtCalls([['-f', '-W', '4242']]), "wk_end_pid's Windows spelling ran instead");
    } finally {
      cleanup(bare.dir);
    }
  });

  await testUnless(IS_WINDOWS, 'the process-group arm is the off-Windows one; Windows ends the tree through taskkill')(
    'off Windows a detached run, its command and its supervisor, is gone and the call returns 0',
    async () => {
      // The command rides out INT and TERM, so only the whole escalation ends it.
      const dir = mkTmp('wf-platform-');
      const pidFile = path.join(dir, 'cmd.pid');
      const cmd = [process.execPath, '-e', [
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        "process.on('SIGINT', () => {}); process.on('SIGTERM', () => {});",
        'setInterval(() => {}, 1000);',
      ].join(' ')];
      const launched = spawnSync(process.execPath, [DETACH, path.join(dir, 'log'), path.join(dir, 'done'), '--', ...cmd],
        { encoding: 'utf8', timeout: SPAWN_DEADLINE });
      assertEq(launched.status, 0, `detach.js launched the run, stderr: ${launched.stderr}`);
      const supervisor = Number(launched.stdout.trim());
      let command;
      try {
        assert(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8') !== ''), 'the command never started');
        command = Number(fs.readFileSync(pidFile, 'utf8'));
        const res = inPlatform(`wk_end_run ${supervisor}`);
        assertEq(res.code, 0, `the call returns 0, stderr: ${res.err}`);
        assert(await until(() => !alive(command) && !alive(supervisor)),
          `the command (pid ${command}) or the supervisor (pid ${supervisor}) outlived wk_end_run`);
      } finally {
        for (const pid of [command, supervisor].filter(Boolean)) endTree(pid, 'SIGKILL');
        cleanup(dir);
      }
    },
  );

  await test('wk_pid_alive: 0 for a live pid, non-zero for one that is gone', () => {
    // Node on PATH, since a pid Node printed is the kind the seam is asked about.
    const env = { PATH: systemPathWith(NODE_DIR) };
    const live = inPlatform(`wk_pid_alive ${process.pid}`, env);
    assertEq(live.code, 0, `this process is alive, stderr: ${live.err}`);
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    const gone = inPlatform(`wk_pid_alive ${dead}`, env);
    assert(gone.code !== 0 && gone.code !== null, `a pid that has ended answers non-zero, got: ${gone.code}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
