// Tests for workflow/lib/platform.sh: the engine's platform seam, the one home of
// the spellings macOS, Windows (Git Bash) and Linux disagree about. The engine and
// the hook layer both source it, so it has its own suite; the Windows branch is
// driven by an inherited OSTYPE plus a `cygpath` on PATH.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { group, test, assert, assertEq, testUnless, summary, selfRun } = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_PATH, NO_RC, NO_NODE_STUB, shellPath, cygpathStub, homeEnv,
  stubTool, which, pathWith, systemPathWith, asWindows,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');

const PLATFORM = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source platform.sh and run one line of shell in it, the way every caller does. */
const inPlatform = (script, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(PLATFORM)}\n${script}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: 30000,
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
 * A child process listening on a free port, and the port it took: the shape a
 * port takeover finds. Written with process.stdout rather than console.log,
 * which paints a number once FORCE_COLOR is set and would hand the case a port
 * wrapped in escapes.
 *
 * `ignoreTerm` gives the child a SIGTERM handler that does nothing, which is
 * the listener the tower's escalation exists for: it rides out the polite
 * signal and only the forced one ends it.
 * @param {boolean} [ignoreTerm]
 */
const listener = (ignoreTerm = false) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['-e', [
    ignoreTerm ? "process.on('SIGTERM',()=>{});" : '',
    "const s=require('net').createServer();",
    "s.listen(0,'127.0.0.1',()=>process.stdout.write(`${s.address().port}\\n`));",
    'setInterval(()=>{},1000);',
  ].join('')], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.on('error', reject);
  child.stdout.on('data', (chunk) => {
    out += chunk.toString();
    if (out.includes('\n')) resolve({ child, port: Number(out.trim()) });
  });
});

/** Whether the child is gone within the deadline. */
const ended = (child, ms = 10000) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(true); return; }
  const timer = setTimeout(() => resolve(false), ms);
  child.on('exit', () => { clearTimeout(timer); resolve(true); });
});

const run = async () => {
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
      const { child, port } = await listener(forced);
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
        child.kill('SIGKILL');
      }
    }
  });

  // The seam the suites spawn through (tests/lib/platform.js) rather than the
  // one the engine sources, because the two answer the same question for the
  // two halves of this repo and neither has another home. A suite that got
  // these wrong would reach the developer's own machine to pass.
  group('tests/lib/platform: the world a spawn gets');

  /** A PATH directory holding one stub, written the one way the seam writes them. */
  const stubWorld = () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'wkstub', ['#!/usr/bin/env bash', `printf 'stub says %s\n' "$1"`]);
    return dir;
  };

  await test('a stub the seam wrote answers by name in a shell, on every platform', () => {
    const dir = stubWorld();
    const res = spawnSync(BASH, [...NO_RC, '-c', 'wkstub hello'], {
      env: { PATH: systemPathWith(dir) }, encoding: 'utf8', timeout: 30000,
    });
    assertEq((res.stdout || '').trim(), 'stub says hello', `the stub answered, stderr: ${res.stderr}`);
    cleanup(dir);
  });

  // The other half of that question, which only one platform can answer. The
  // rule and its reason live with the helper that writes the stub; every case
  // that cannot be answered for it names the same sentence.
  const nodeSpawn = testUnless(IS_WINDOWS, NO_NODE_STUB);

  await nodeSpawn('a stub the seam wrote is startable by name from Node', () => {
    const dir = stubWorld();
    const res = spawnSync('wkstub', ['hello'], {
      env: { ...process.env, PATH: pathWith(dir) }, encoding: 'utf8', timeout: 30000,
    });
    assertEq((res.stdout || '').trim(), 'stub says hello',
      `the stub answered, error: ${res.error && res.error.message}`);
    cleanup(dir);
  });

  await test('the scratch home the builder names is the one a child answers with', () => {
    // HOME alone is not a scratch home on Windows: os.homedir() there reads
    // USERPROFILE, so a child given only HOME sweeps the developer's own.
    const home = mkTmp('wf-platform-');
    const res = spawnSync(process.execPath, ['-p', 'require("os").homedir()'], {
      env: homeEnv(home, { PATH: process.env.PATH }), encoding: 'utf8', timeout: 30000,
    });
    assertEq((res.stdout || '').trim(), home, `the child's home, stderr: ${res.stderr}`);
    assert(home !== os.homedir(), 'which is not the one this machine runs under');
    cleanup(home);
  });

  await test('gh is pointed at a config under that same home, on every platform', () => {
    const home = mkTmp('wf-platform-');
    const env = homeEnv(home, {});
    assertEq(env.GH_CONFIG_DIR, path.join(home, '.config', 'gh'), 'the key the seal is made of');
    // Not "outside the real home": a Windows temp directory sits inside the
    // profile, so the only thing that has to miss is the config gh would have
    // read on its own.
    assert(env.GH_CONFIG_DIR !== path.join(os.homedir(), '.config', 'gh'),
      `never the developer's own: ${env.GH_CONFIG_DIR}`);
    cleanup(home);
  });

  await test('a child started in that home writes no compile cache, the leftover npm 10 would leave', () => {
    const home = mkTmp('wf-platform-');
    const cache = path.join(home, 'compile-cache');
    const script = "require('node:module').enableCompileCache(process.argv[1]); require('node:path');";
    const res = spawnSync(process.execPath, ['-e', script, cache], { env: homeEnv(home, {}), encoding: 'utf8', timeout: 30000 });
    assertEq(res.status, 0, `the child ran, got: ${res.stderr}`);
    const left = fs.existsSync(cache) ? fs.readdirSync(cache) : [];
    assertEq(left.length, 0, `nothing cached under the scratch home, got: ${left.join(', ')}`);
    cleanup(home);
  });

  const ghTest = testUnless(!which('gh'), 'this machine has no gh to ask');

  await ghTest('a gh spawned in that world is a gh with no account', () => {
    // The whole point, end to end: whichever gh a spawn resolved, the real one
    // included, it can reach nothing of the developer's, even when the shell
    // this suite was started from carries a token of its own.
    const home = mkTmp('wf-platform-');
    const res = spawnSync(which('gh'), ['auth', 'status'], {
      env: homeEnv(home, { ...process.env, GH_TOKEN: 'gho_a_token_the_shell_carried' }),
      encoding: 'utf8',
      timeout: 30000,
    });
    const said = `${res.stdout || ''}${res.stderr || ''}`;
    assert(/not logged in|gh auth login/i.test(said), `no account answered: ${said}`);
    assert(!/Logged in to/i.test(said), `and nobody's account was reached: ${said}`);
    cleanup(home);
  });

  group('tests/lib/platform: the spelling a shell reads');

  await test('a native path becomes the one Git Bash reads, and one already in it is returned as it came', () => {
    // `asWindows` is how a Mac reaches that branch at all, so the answer has to
    // come from the platform as it is when the question is asked. A path with
    // spaces, because a Windows profile directory has them and a translation
    // that quoted or split would eat them.
    assertEq(asWindows(() => shellPath('C:\\Users\\My Name\\t mp')), '/c/Users/My Name/t mp',
      'the drive becomes a mount and every separator turns');
    assertEq(asWindows(() => shellPath('/c/Users/My Name/t mp')), '/c/Users/My Name/t mp',
      'nothing is translated twice');
  });

  await test('a path under the folder Git Bash mounts at /tmp reads as /tmp, any other keeps its drive', () => {
    // The mount is asked of Git Bash once per process, so a fresh node asks it: a
    // Mac through the seam's cygpath (which mounts /tmp at C:\tmp), Windows
    // through the real one, whose mount a child's TEMP does not move.
    const dir = cygpathWorld();
    const root = IS_WINDOWS
      ? spawnSync(which('cygpath'), ['-w', '/tmp'], { encoding: 'utf8', timeout: 30000 }).stdout.trim()
      : 'C:\\tmp';
    const probe = [
      `const { shellPath, asWindows } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'platform.js'))});`,
      'const root = process.argv[1];',
      'const asked = asWindows(() => [`${root}\\\\wf\\\\x y`, `${root.toUpperCase()}\\\\x`,',
      "  `${root.replace(/\\\\/g, '/')}/x`, root, `${root}x\\\\y`, 'C:\\\\Windows\\\\x'].map(shellPath));",
      "const native = process.platform === 'win32' ? null : shellPath(`${root}\\\\x`);",
      'process.stdout.write(JSON.stringify({ asked, native }));',
    ].join('\n');
    const res = spawnSync(process.execPath, ['-e', probe, root], {
      env: { ...process.env, PATH: pathWith(dir) },
      encoding: 'utf8',
      timeout: 30000,
    });
    assertEq(res.status, 0, `the probe ran, stderr: ${res.stderr}`);
    const { asked: [under, upper, slashed, itself, sibling, other], native } = JSON.parse(res.stdout);
    assertEq(under, '/tmp/wf/x y', 'a path under the mount reads as /tmp');
    assertEq(upper, '/tmp/x', 'the drive and folder names compare without case');
    assertEq(slashed, '/tmp/x', 'forward slashes compare the same as backslashes');
    assertEq(itself, '/tmp', 'the mount root itself is /tmp');
    assert(/^\/[a-z]\/.*x\/y$/.test(sibling), `a sibling sharing the prefix keeps its drive, got: ${sibling}`);
    assertEq(other, '/c/Windows/x', 'any other path keeps its drive');
    if (!IS_WINDOWS) assertEq(native, 'C:\\tmp\\x', 'macOS leaves the path as it came');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
