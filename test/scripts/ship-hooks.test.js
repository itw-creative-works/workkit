// Tests for workflow/ship/hooks.js, the library every ship command runs its
// event's hooks through: `runHooks(root, event)` runs the commands the repo's
// `.workkit/settings.json` declares under `hooks.<event>`, in order, from the
// root, only where that file says `"enabled": true`. Each case calls it in a
// child node, since the hooks share the caller's stdio, and each fixture command
// leaves a mark on disk, so order, cwd and "the rest did not run" read from files.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun, mkTmp, WORKKIT_DIR, SPAWN_DEADLINE,
} = require('../lib/harness');
const { IS_WINDOWS, SYSTEM_PATH, homeEnv } = require('../lib/platform');
const { enabledWith, lines } = require('../lib/ship-world');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'ship', 'hooks.js');

// Calls runHooks(root, event) and exits with what it returned; any return but 0 or 1 is exit 9.
const DRIVER = [
  'const [lib, root, event] = process.argv.slice(1);',
  'Promise.resolve(require(lib).runHooks(root, event))',
  '  .then((code) => process.exit(code === 0 || code === 1 ? code : 9));',
].join('\n');

// A Git Bash process that signals itself reaches Node as a plain exit code on Windows.
const signalTest = testUnless(IS_WINDOWS, 'Node sees no signal from a Git Bash process that ends itself on Windows');

/**
 * A case's world: a home, and a repo with an empty `sub/` the driver starts
 * from. `settings` given as a string is written as it is, an object as JSON,
 * and `undefined` writes no settings file at all. `mark(name)` reads a file at
 * the repo root, null when it is not there.
 */
const mkWorld = (settings) => {
  const dir = mkTmp('ship-hooks-');
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  if (settings !== undefined) {
    fs.mkdirSync(path.join(repo, WORKKIT_DIR), { recursive: true });
    fs.writeFileSync(path.join(repo, WORKKIT_DIR, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
  }
  const mark = (name) => {
    const file = path.join(repo, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return { dir, home, repo, sub: path.join(repo, 'sub'), mark };
};

const spawnDriver = (w, event, stdio, PATH, env = {}) => spawnSync(process.execPath, ['-e', DRIVER, LIB, w.repo, event], {
  cwd: w.sub,
  env: homeEnv(w.home, { ...env, PATH }),
  stdio,
  encoding: 'utf8',
  timeout: SPAWN_DEADLINE,
});

/** runHooks with stdout and stderr in one file: `all` is that file, in write order. */
const run = (w, event = 'afterPublish', PATH = SYSTEM_PATH, env = {}) => {
  const outFile = path.join(w.dir, 'output.log');
  const fd = fs.openSync(outFile, 'w');
  let res;
  try {
    res = spawnDriver(w, event, ['ignore', fd, fd], PATH, env);
  } finally {
    fs.closeSync(fd);
  }
  assert(res.status !== null, `the driver finished (no timeout): ${res.error || ''}`);
  return { code: res.status, all: fs.readFileSync(outFile, 'utf8') };
};

/** runHooks with its two streams apart. */
const runPiped = (w, event = 'afterPublish') => {
  const res = spawnDriver(w, event, ['ignore', 'pipe', 'pipe'], SYSTEM_PATH);
  assert(res.status !== null, `the driver finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The harness compares with `===`, so a list is compared in its JSON form.
const assertList = (actual, expected, msg) => assertEq(JSON.stringify(actual), JSON.stringify(expected), msg);

const NOT_ENABLED = (event) => `ship-hooks: ${event}: hooks run only where .workkit/settings.json says "enabled": true`;

// A cloud session as the kit tells one; homeEnv starts from an empty env, so a machine run carries none.
const CLOUD = { CLAUDE_CODE_REMOTE: 'true' };
const SKIPPED = 'skipped: local only, this is a cloud session';

/** Settings turning workkit on with `entries` (whole entry objects) under `event`. */
const enabledEntries = (event, entries) => ({ enabled: true, hooks: { [event]: entries } });

const cases = async () => {
  group('ship hooks: a repo not enabled');

  await test('a missing file, an empty one, or one with no hooks for the event: nothing printed, nothing run, 0', () => {
    const shapes = {
      'no settings file': undefined,
      'an empty settings file': '',
      '"enabled": false and no hooks': { enabled: false },
      '"enabled": false with hooks for another event': { enabled: false, hooks: { afterDeploy: [{ command: 'echo ran >> ran.txt' }] } },
    };
    for (const [name, settings] of Object.entries(shapes)) {
      const w = mkWorld(settings);
      const { code, all } = run(w);
      assertEq(code, 0, `${name}: 0, got: ${all}`);
      assertEq(all, '', `${name}: nothing printed`);
      assertEq(w.mark('ran.txt'), null, `${name}: nothing ran`);
    }
  });

  await test('"enabled": false, or no enabled key, with hooks for the event: one line, nothing run, 0', () => {
    const hooks = { afterPublish: [{ command: 'echo ran >> ran.txt' }] };
    for (const [name, settings] of Object.entries({ '"enabled": false': { enabled: false, hooks }, 'no enabled key': { hooks } })) {
      const w = mkWorld(settings);
      const { code, all } = run(w);
      assertEq(code, 0, `${name}: 0, got: ${all}`);
      assertEq(all, `${NOT_ENABLED('afterPublish')}\n`, `${name}: the one line`);
      assertEq(w.mark('ran.txt'), null, `${name}: nothing ran`);
    }
  });

  await test('a machine settings file saying "enabled": true turns no repo on: one line, nothing run, 0', () => {
    const w = mkWorld({ hooks: { afterPublish: [{ command: 'echo ran >> ran.txt' }] } });
    fs.mkdirSync(path.join(w.home, WORKKIT_DIR), { recursive: true });
    fs.writeFileSync(path.join(w.home, WORKKIT_DIR, 'settings.json'), '{ "enabled": true }\n');
    const { code, all } = run(w);
    assertEq(code, 0, `0, got: ${all}`);
    assertEq(all, `${NOT_ENABLED('afterPublish')}\n`, 'the one line');
    assertEq(w.mark('ran.txt'), null, 'nothing ran');
  });

  group('ship hooks: an enabled repo');

  await test('no hooks for the event: one line on stderr, 0', () => {
    const shapes = {
      'no hooks key': { enabled: true },
      'an empty hooks object': { enabled: true, hooks: {} },
      'hooks for another event only': enabledWith({ afterDeploy: ['echo ran >> ran.txt'] }),
      'an empty list': { enabled: true, hooks: { afterPublish: [] } },
      'hooks null, which leaves the default lists': { enabled: true, hooks: null },
    };
    for (const [name, settings] of Object.entries(shapes)) {
      const w = mkWorld(settings);
      const { code, out, err } = runPiped(w);
      assertEq(code, 0, `${name}: 0, got: ${err}`);
      assertEq(err, 'ship-hooks: no afterPublish hooks\n', `${name}: the one line`);
      assertEq(out, '', `${name}: nothing on stdout`);
      assertEq(w.mark('ran.txt'), null, `${name}: nothing ran`);
    }
  });

  await test('each of the three events runs its own hooks and no other event\'s', () => {
    assertList([...require(LIB).EVENTS].sort(), ['afterDeploy', 'afterPublish', 'afterRelease'], 'the events');
    const settings = enabledWith(Object.fromEntries(['afterRelease', 'afterPublish', 'afterDeploy'].map((e) => [e, [`echo ${e} >> ran.txt`]])));
    for (const event of ['afterRelease', 'afterPublish', 'afterDeploy']) {
      const w = mkWorld(settings);
      const { code, all } = run(w, event);
      assertEq(code, 0, `${event}: 0, got: ${all}`);
      assertEq(w.mark('ran.txt'), `${event}\n`, `${event}: its hook alone ran`);
    }
  });

  await test('each command runs through bash at the root, announced before it, its streams passed through; all passing is 0', () => {
    const first = 'echo one >> order.txt && echo out-one && echo err-one >&2';
    const second = 'printf "%s\\n" two | cat >> order.txt; echo out-two';
    const w = mkWorld(enabledWith({ afterPublish: [first, second] }));
    const { code, all } = run(w);
    assertEq(code, 0, `0, got: ${all}`);
    assertList(lines(all), [
      `ship-hooks: afterPublish [1/2] ${first}`,
      'out-one',
      'err-one',
      `ship-hooks: afterPublish [2/2] ${second}`,
      'out-two',
    ], 'each [i/n] line before its command\'s output');
    assertEq(w.mark('order.txt'), 'one\ntwo\n', 'both ran, in order, at the root');
    assertEq(fs.existsSync(path.join(w.sub, 'order.txt')), false, 'nothing ran in the folder the caller stood in');

    const apart = mkWorld(enabledWith({ afterPublish: ['echo out-mark; echo err-mark >&2'] }));
    const piped = runPiped(apart);
    assertEq(piped.code, 0, `0, got: ${piped.err}`);
    assertEq(piped.out, 'out-mark\n', 'stdout is the command\'s alone');
    assertList(lines(piped.err), ['ship-hooks: afterPublish [1/1] echo out-mark; echo err-mark >&2', 'err-mark'], 'the hooks line and the command\'s stderr on stderr');
  });

  group('ship hooks: a command failing');

  await test('a command exiting non-zero: its line, 1, the later commands never run', () => {
    const w = mkWorld(enabledWith({ afterPublish: ['echo one >> order.txt', 'exit 3', 'echo three >> order.txt'] }));
    const { code, all } = run(w);
    assertEq(code, 1, `1, got: ${all}`);
    assert(lines(all).includes('ship-hooks: afterPublish exit 3 exited 3'), `the failure line, got: ${all}`);
    assertEq(w.mark('order.txt'), 'one\n', 'the first ran, the third did not');
  });

  await signalTest('a command ended by a signal: its did-not-finish line names the signal, 1, the later commands never run', () => {
    const killed = 'kill -TERM $$';
    const w = mkWorld(enabledWith({ afterPublish: [killed, 'echo two >> order.txt'] }));
    const { code, all } = run(w);
    assertEq(code, 1, `1, got: ${all}`);
    assert(lines(all).includes(`ship-hooks: afterPublish ${killed} did not finish (SIGTERM)`), `the failure line, got: ${all}`);
    assertEq(w.mark('order.txt'), null, 'the second never ran');
  });

  await test('a command that cannot start (no bash on PATH): its could-not-be-run line, 1, the later commands never run', () => {
    const w = mkWorld(enabledWith({ afterPublish: ['echo one >> order.txt', 'echo two >> order.txt'] }));
    const empty = path.join(w.dir, 'bin');
    fs.mkdirSync(empty);
    const { code, all } = run(w, 'afterPublish', empty);
    assertEq(code, 1, `1, got: ${all}`);
    assert(lines(all).includes('ship-hooks: afterPublish echo one >> order.txt could not be run, ENOENT'), `the failure line, got: ${all}`);
    assertEq(w.mark('order.txt'), null, 'neither command ran');
  });

  group('ship hooks: a bad declaration');

  await test('a settings file that does not parse, or a hooks shape that is wrong: one line, nothing run, 1', () => {
    const marker = 'echo ran >> ran.txt';
    const shapes = {
      'settings that do not parse': `{"enabled": true, "hooks": {"afterPublish": [{"command": "${marker}"}]}`,
      'the hooks block a list': { enabled: true, hooks: [{ command: marker }] },
      'the hooks block a string': { enabled: true, hooks: marker },
      'the event an object': { enabled: true, hooks: { afterPublish: { command: marker } } },
      'an entry a bare string': { enabled: true, hooks: { afterPublish: [marker] } },
      'an entry with no command': { enabled: true, hooks: { afterPublish: [{ command: marker }, {}] } },
      'an entry with an empty command': { enabled: true, hooks: { afterPublish: [{ command: marker }, { command: '' }] } },
      'an entry with a number command': { enabled: true, hooks: { afterPublish: [{ command: marker }, { command: 5 }] } },
    };
    for (const [name, settings] of Object.entries(shapes)) {
      const w = mkWorld(settings);
      const { code, all } = run(w);
      assertEq(code, 1, `${name}: 1, got: ${all}`);
      const got = lines(all);
      assertEq(got.length, 1, `${name}: one line, got: ${all}`);
      assert(got[0].startsWith('ship-hooks: '), `${name}: the line is the library's, got: ${got[0]}`);
      if (name.startsWith('the hooks block')) assert(got[0].includes('hooks in .workkit/settings.json is not an object'), `${name}: the line names the file, got: ${got[0]}`);
      assertEq(w.mark('ran.txt'), null, `${name}: nothing ran`);
    }
  });

  await test('a machine settings file whose hooks block is no object: one line naming it, nothing run, 1', () => {
    const w = mkWorld({ enabled: true, hooks: { afterPublish: [{ command: 'echo ran >> ran.txt' }] } });
    const machine = path.join(w.home, WORKKIT_DIR, 'settings.json');
    fs.mkdirSync(path.dirname(machine), { recursive: true });
    fs.writeFileSync(machine, JSON.stringify({ hooks: ['echo other'] }));
    const { code, all } = run(w);
    assertEq(code, 1, `1, got: ${all}`);
    assertEq(lines(all).join('\n'), `ship-hooks: hooks in ${machine} is not an object, so no afterPublish hook ran`);
    assertEq(w.mark('ran.txt'), null, 'nothing ran');
  });

  await test('a machine hooks block that is no object leaves a repo without "enabled": true alone: nothing printed, 0', () => {
    const w = mkWorld({});
    const machine = path.join(w.home, WORKKIT_DIR, 'settings.json');
    fs.mkdirSync(path.dirname(machine), { recursive: true });
    fs.writeFileSync(machine, JSON.stringify({ hooks: ['echo other'] }));
    const { code, all } = run(w);
    assertEq(code, 0, `0, got: ${all}`);
    assertEq(all, '', 'nothing printed');
  });

  group('ship hooks: a local-only entry');

  await test('on a machine a local entry runs like any other, local false or absent alike', () => {
    const entries = [
      { command: 'echo one >> order.txt' },
      { command: 'echo local >> order.txt', local: true },
      { command: 'echo three >> order.txt', local: false },
    ];
    for (const [name, env] of Object.entries({ 'no CLAUDE_CODE_REMOTE': {}, 'CLAUDE_CODE_REMOTE=false': { CLAUDE_CODE_REMOTE: 'false' } })) {
      const w = mkWorld(enabledEntries('afterRelease', entries));
      const { code, all } = run(w, 'afterRelease', SYSTEM_PATH, env);
      assertEq(code, 0, `${name}: 0, got: ${all}`);
      assertList(lines(all), [
        'ship-hooks: afterRelease [1/3] echo one >> order.txt',
        'ship-hooks: afterRelease [2/3] echo local >> order.txt',
        'ship-hooks: afterRelease [3/3] echo three >> order.txt',
      ], `${name}: every entry announced and run`);
      assertEq(w.mark('order.txt'), 'one\nlocal\nthree\n', `${name}: all three ran, in order`);
    }
  });

  await test('in a cloud session a local entry is skipped with its line, and the entries after it still run, for every event', () => {
    for (const event of ['afterRelease', 'afterPublish', 'afterDeploy']) {
      const w = mkWorld(enabledEntries(event, [
        { command: 'echo one >> order.txt' },
        { command: 'echo local >> order.txt', local: true },
        { command: 'echo three >> order.txt', local: false },
      ]));
      const { code, all } = run(w, event, SYSTEM_PATH, CLOUD);
      assertEq(code, 0, `${event}: 0, got: ${all}`);
      assertList(lines(all), [
        `ship-hooks: ${event} [1/3] echo one >> order.txt`,
        `ship-hooks: ${event} [2/3] echo local >> order.txt ${SKIPPED}`,
        `ship-hooks: ${event} [3/3] echo three >> order.txt`,
      ], `${event}: the skip line in the local entry's place, its index and the total`);
      assertEq(w.mark('order.txt'), 'one\nthree\n', `${event}: the local entry alone did not run`);
    }
  });

  await test('a failing entry stays loud beside a local one: 1, its line, the later entries never run', () => {
    const cloud = mkWorld(enabledEntries('afterRelease', [
      { command: 'echo local >> order.txt', local: true },
      { command: 'exit 3' },
      { command: 'echo three >> order.txt' },
    ]));
    const inCloud = run(cloud, 'afterRelease', SYSTEM_PATH, CLOUD);
    assertEq(inCloud.code, 1, `cloud: 1, got: ${inCloud.all}`);
    assert(lines(inCloud.all).includes(`ship-hooks: afterRelease [1/3] echo local >> order.txt ${SKIPPED}`), `cloud: the skip line, got: ${inCloud.all}`);
    assert(lines(inCloud.all).includes('ship-hooks: afterRelease exit 3 exited 3'), `cloud: the failure line, got: ${inCloud.all}`);
    assertEq(cloud.mark('order.txt'), null, 'cloud: neither the skipped entry nor the one after the failure ran');

    const machine = mkWorld(enabledEntries('afterRelease', [
      { command: 'exit 4', local: true },
      { command: 'echo two >> order.txt' },
    ]));
    const onMachine = run(machine, 'afterRelease');
    assertEq(onMachine.code, 1, `machine: 1, got: ${onMachine.all}`);
    assert(lines(onMachine.all).includes('ship-hooks: afterRelease exit 4 exited 4'), `machine: the local entry's failure line, got: ${onMachine.all}`);
    assertEq(machine.mark('order.txt'), null, 'machine: the entry after the failing local one never ran');
  });

  await test('a local that is neither true nor false is a shape error on a machine and in the cloud: one line, nothing run, 1', () => {
    const marker = 'echo ran >> ran.txt';
    const values = { 'the string "true"': 'true', 'the number 1': 1, 'a word': 'yes', 'an object': {} };
    for (const [name, local] of Object.entries(values)) {
      for (const [where, env] of Object.entries({ machine: {}, cloud: CLOUD })) {
        const w = mkWorld(enabledEntries('afterPublish', [{ command: marker }, { command: marker, local }]));
        const { code, all } = run(w, 'afterPublish', SYSTEM_PATH, env);
        assertEq(code, 1, `${name}, ${where}: 1, got: ${all}`);
        const got = lines(all);
        assertEq(got.length, 1, `${name}, ${where}: one line, got: ${all}`);
        assert(got[0].startsWith('ship-hooks: hooks.afterPublish['), `${name}, ${where}: the line names the entry, got: ${got[0]}`);
        assert(got[0].endsWith('in the settings has a local that is not true or false, so no afterPublish hook ran'), `${name}, ${where}: the line says what is wrong, got: ${got[0]}`);
        assertEq(w.mark('ran.txt'), null, `${name}, ${where}: the valid entry before it did not run either`);
      }
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
