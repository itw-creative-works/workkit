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
  describe, test, expect, mkTmp, WORKKIT_DIR, SPAWN_DEADLINE,
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
  expect(res.status !== null, `the driver finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, all: fs.readFileSync(outFile, 'utf8') };
};

/** runHooks with its two streams apart. */
const runPiped = (w, event = 'afterPublish') => {
  const res = spawnDriver(w, event, ['ignore', 'pipe', 'pipe'], SYSTEM_PATH);
  expect(res.status !== null, `the driver finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The harness compares with `===`, so a list is compared in its JSON form.
const assertList = (actual, expected, msg) => expect(JSON.stringify(actual), msg).toBe(JSON.stringify(expected));

const NOT_ENABLED = (event) => `ship-hooks: ${event}: hooks run only where .workkit/settings.json says "enabled": true`;

// A cloud session as the kit tells one; homeEnv starts from an empty env, so a machine run carries none.
const CLOUD = { CLAUDE_CODE_REMOTE: 'true' };
const SKIPPED = 'skipped: local only, this is a cloud session';

/** Settings turning workkit on with `entries` (whole entry objects) under `event`. */
const enabledEntries = (event, entries) => ({ enabled: true, hooks: { [event]: entries } });

describe('ship hooks: a repo not enabled', () => {
  test('a missing file, an empty one, or one with no hooks for the event: nothing printed, nothing run, 0', () => {
    const shapes = {
      'no settings file': undefined,
      'an empty settings file': '',
      '"enabled": false and no hooks': { enabled: false },
      '"enabled": false with hooks for another event': { enabled: false, hooks: { afterDeploy: [{ command: 'echo ran >> ran.txt' }] } },
    };
    for (const [name, settings] of Object.entries(shapes)) {
      const w = mkWorld(settings);
      const { code, all } = run(w);
      expect(code, `${name}: 0, got: ${all}`).toBe(0);
      expect(all, `${name}: nothing printed`).toBe('');
      expect(w.mark('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });

  test('"enabled": false, or no enabled key, with hooks for the event: one line, nothing run, 0', () => {
    const hooks = { afterPublish: [{ command: 'echo ran >> ran.txt' }] };
    for (const [name, settings] of Object.entries({ '"enabled": false': { enabled: false, hooks }, 'no enabled key': { hooks } })) {
      const w = mkWorld(settings);
      const { code, all } = run(w);
      expect(code, `${name}: 0, got: ${all}`).toBe(0);
      expect(all, `${name}: the one line`).toBe(`${NOT_ENABLED('afterPublish')}\n`);
      expect(w.mark('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });

  test('a machine settings file saying "enabled": true turns no repo on: one line, nothing run, 0', () => {
    const w = mkWorld({ hooks: { afterPublish: [{ command: 'echo ran >> ran.txt' }] } });
    fs.mkdirSync(path.join(w.home, WORKKIT_DIR), { recursive: true });
    fs.writeFileSync(path.join(w.home, WORKKIT_DIR, 'settings.json'), '{ "enabled": true }\n');
    const { code, all } = run(w);
    expect(code, `0, got: ${all}`).toBe(0);
    expect(all, 'the one line').toBe(`${NOT_ENABLED('afterPublish')}\n`);
    expect(w.mark('ran.txt'), 'nothing ran').toBe(null);
  });
});

describe('ship hooks: an enabled repo', () => {
  test('no hooks for the event: one line on stderr, 0', () => {
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
      expect(code, `${name}: 0, got: ${err}`).toBe(0);
      expect(err, `${name}: the one line`).toBe('ship-hooks: no afterPublish hooks\n');
      expect(out, `${name}: nothing on stdout`).toBe('');
      expect(w.mark('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });

  test('each of the three events runs its own hooks and no other event\'s', () => {
    assertList([...require(LIB).EVENTS].sort(), ['afterDeploy', 'afterPublish', 'afterRelease'], 'the events');
    const settings = enabledWith(Object.fromEntries(['afterRelease', 'afterPublish', 'afterDeploy'].map((e) => [e, [`echo ${e} >> ran.txt`]])));
    for (const event of ['afterRelease', 'afterPublish', 'afterDeploy']) {
      const w = mkWorld(settings);
      const { code, all } = run(w, event);
      expect(code, `${event}: 0, got: ${all}`).toBe(0);
      expect(w.mark('ran.txt'), `${event}: its hook alone ran`).toBe(`${event}\n`);
    }
  });

  test('a hooks.ciSetup list beside the ship events is accepted and never run by any of them', () => {
    const settings = {
      enabled: true,
      hooks: { ciSetup: [{ command: 'echo ci >> ci.txt' }], afterRelease: [{ command: 'echo afterRelease >> ran.txt' }] },
    };
    for (const event of ['afterRelease', 'afterPublish', 'afterDeploy']) {
      const w = mkWorld(settings);
      const { code, all } = run(w, event);
      expect(code, `${event}: 0, got: ${all}`).toBe(0);
      expect(w.mark('ci.txt'), `${event}: the ciSetup command never ran`).toBe(null);
      expect(w.mark('ran.txt'), `${event}: its own hooks alone ran`).toBe(event === 'afterRelease' ? 'afterRelease\n' : null);
    }
  });

  test('each command runs through bash at the root, announced before it, its streams passed through; all passing is 0', () => {
    const first = 'echo one >> order.txt && echo out-one && echo err-one >&2';
    const second = 'printf "%s\\n" two | cat >> order.txt; echo out-two';
    const w = mkWorld(enabledWith({ afterPublish: [first, second] }));
    const { code, all } = run(w);
    expect(code, `0, got: ${all}`).toBe(0);
    assertList(lines(all), [
      `ship-hooks: afterPublish [1/2] ${first}`,
      'out-one',
      'err-one',
      `ship-hooks: afterPublish [2/2] ${second}`,
      'out-two',
    ], 'each [i/n] line before its command\'s output');
    expect(w.mark('order.txt'), 'both ran, in order, at the root').toBe('one\ntwo\n');
    expect(fs.existsSync(path.join(w.sub, 'order.txt')), 'nothing ran in the folder the caller stood in').toBe(false);

    const apart = mkWorld(enabledWith({ afterPublish: ['echo out-mark; echo err-mark >&2'] }));
    const piped = runPiped(apart);
    expect(piped.code, `0, got: ${piped.err}`).toBe(0);
    expect(piped.out, 'stdout is the command\'s alone').toBe('out-mark\n');
    assertList(lines(piped.err), ['ship-hooks: afterPublish [1/1] echo out-mark; echo err-mark >&2', 'err-mark'], 'the hooks line and the command\'s stderr on stderr');
  });
});

describe('ship hooks: a command failing', () => {
  test('a command exiting non-zero: its line, 1, the later commands never run', () => {
    const w = mkWorld(enabledWith({ afterPublish: ['echo one >> order.txt', 'exit 3', 'echo three >> order.txt'] }));
    const { code, all } = run(w);
    expect(code, `1, got: ${all}`).toBe(1);
    expect(lines(all).includes('ship-hooks: afterPublish exit 3 exited 3'), `the failure line, got: ${all}`).toBeTruthy();
    expect(w.mark('order.txt'), 'the first ran, the third did not').toBe('one\n');
  });

  test('a command ended by a signal: its did-not-finish line names the signal, 1, the later commands never run', { skip: IS_WINDOWS && 'Node sees no signal from a Git Bash process that ends itself on Windows' }, () => {
    const killed = 'kill -TERM $$';
    const w = mkWorld(enabledWith({ afterPublish: [killed, 'echo two >> order.txt'] }));
    const { code, all } = run(w);
    expect(code, `1, got: ${all}`).toBe(1);
    expect(lines(all).includes(`ship-hooks: afterPublish ${killed} did not finish (SIGTERM)`), `the failure line, got: ${all}`).toBeTruthy();
    expect(w.mark('order.txt'), 'the second never ran').toBe(null);
  });

  test('a command that cannot start (no bash on PATH): its could-not-be-run line, 1, the later commands never run', () => {
    const w = mkWorld(enabledWith({ afterPublish: ['echo one >> order.txt', 'echo two >> order.txt'] }));
    const empty = path.join(w.dir, 'bin');
    fs.mkdirSync(empty);
    const { code, all } = run(w, 'afterPublish', empty);
    expect(code, `1, got: ${all}`).toBe(1);
    expect(lines(all).includes('ship-hooks: afterPublish echo one >> order.txt could not be run, ENOENT'), `the failure line, got: ${all}`).toBeTruthy();
    expect(w.mark('order.txt'), 'neither command ran').toBe(null);
  });
});

describe('ship hooks: a bad declaration', () => {
  test('a settings file that does not parse, or a hooks shape that is wrong: one line, nothing run, 1', () => {
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
      expect(code, `${name}: 1, got: ${all}`).toBe(1);
      const got = lines(all);
      expect(got.length, `${name}: one line, got: ${all}`).toBe(1);
      expect(got[0].startsWith('ship-hooks: '), `${name}: the line is the library's, got: ${got[0]}`).toBeTruthy();
      if (name.startsWith('the hooks block')) expect(got[0].includes('hooks in .workkit/settings.json is not an object'), `${name}: the line names the file, got: ${got[0]}`).toBeTruthy();
      expect(w.mark('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });

  test('a machine settings file whose hooks block is no object: one line naming it, nothing run, 1', () => {
    const w = mkWorld({ enabled: true, hooks: { afterPublish: [{ command: 'echo ran >> ran.txt' }] } });
    const machine = path.join(w.home, WORKKIT_DIR, 'settings.json');
    fs.mkdirSync(path.dirname(machine), { recursive: true });
    fs.writeFileSync(machine, JSON.stringify({ hooks: ['echo other'] }));
    const { code, all } = run(w);
    expect(code, `1, got: ${all}`).toBe(1);
    expect(lines(all).join('\n')).toBe(`ship-hooks: hooks in ${machine} is not an object, so no afterPublish hook ran`);
    expect(w.mark('ran.txt'), 'nothing ran').toBe(null);
  });

  test('a machine hooks block that is no object leaves a repo without "enabled": true alone: nothing printed, 0', () => {
    const w = mkWorld({});
    const machine = path.join(w.home, WORKKIT_DIR, 'settings.json');
    fs.mkdirSync(path.dirname(machine), { recursive: true });
    fs.writeFileSync(machine, JSON.stringify({ hooks: ['echo other'] }));
    const { code, all } = run(w);
    expect(code, `0, got: ${all}`).toBe(0);
    expect(all, 'nothing printed').toBe('');
  });
});

describe('ship hooks: a local-only entry', () => {
  test('on a machine a local entry runs like any other, local false or absent alike', () => {
    const entries = [
      { command: 'echo one >> order.txt' },
      { command: 'echo local >> order.txt', local: true },
      { command: 'echo three >> order.txt', local: false },
    ];
    for (const [name, env] of Object.entries({ 'no CLAUDE_CODE_REMOTE': {}, 'CLAUDE_CODE_REMOTE=false': { CLAUDE_CODE_REMOTE: 'false' } })) {
      const w = mkWorld(enabledEntries('afterRelease', entries));
      const { code, all } = run(w, 'afterRelease', SYSTEM_PATH, env);
      expect(code, `${name}: 0, got: ${all}`).toBe(0);
      assertList(lines(all), [
        'ship-hooks: afterRelease [1/3] echo one >> order.txt',
        'ship-hooks: afterRelease [2/3] echo local >> order.txt',
        'ship-hooks: afterRelease [3/3] echo three >> order.txt',
      ], `${name}: every entry announced and run`);
      expect(w.mark('order.txt'), `${name}: all three ran, in order`).toBe('one\nlocal\nthree\n');
    }
  });

  test('in a cloud session a local entry is skipped with its line, and the entries after it still run, for every event', () => {
    for (const event of ['afterRelease', 'afterPublish', 'afterDeploy']) {
      const w = mkWorld(enabledEntries(event, [
        { command: 'echo one >> order.txt' },
        { command: 'echo local >> order.txt', local: true },
        { command: 'echo three >> order.txt', local: false },
      ]));
      const { code, all } = run(w, event, SYSTEM_PATH, CLOUD);
      expect(code, `${event}: 0, got: ${all}`).toBe(0);
      assertList(lines(all), [
        `ship-hooks: ${event} [1/3] echo one >> order.txt`,
        `ship-hooks: ${event} [2/3] echo local >> order.txt ${SKIPPED}`,
        `ship-hooks: ${event} [3/3] echo three >> order.txt`,
      ], `${event}: the skip line in the local entry's place, its index and the total`);
      expect(w.mark('order.txt'), `${event}: the local entry alone did not run`).toBe('one\nthree\n');
    }
  });

  test('a failing entry stays loud beside a local one: 1, its line, the later entries never run', () => {
    const cloud = mkWorld(enabledEntries('afterRelease', [
      { command: 'echo local >> order.txt', local: true },
      { command: 'exit 3' },
      { command: 'echo three >> order.txt' },
    ]));
    const inCloud = run(cloud, 'afterRelease', SYSTEM_PATH, CLOUD);
    expect(inCloud.code, `cloud: 1, got: ${inCloud.all}`).toBe(1);
    expect(lines(inCloud.all).includes(`ship-hooks: afterRelease [1/3] echo local >> order.txt ${SKIPPED}`), `cloud: the skip line, got: ${inCloud.all}`).toBeTruthy();
    expect(lines(inCloud.all).includes('ship-hooks: afterRelease exit 3 exited 3'), `cloud: the failure line, got: ${inCloud.all}`).toBeTruthy();
    expect(cloud.mark('order.txt'), 'cloud: neither the skipped entry nor the one after the failure ran').toBe(null);

    const machine = mkWorld(enabledEntries('afterRelease', [
      { command: 'exit 4', local: true },
      { command: 'echo two >> order.txt' },
    ]));
    const onMachine = run(machine, 'afterRelease');
    expect(onMachine.code, `machine: 1, got: ${onMachine.all}`).toBe(1);
    expect(lines(onMachine.all).includes('ship-hooks: afterRelease exit 4 exited 4'), `machine: the local entry's failure line, got: ${onMachine.all}`).toBeTruthy();
    expect(machine.mark('order.txt'), 'machine: the entry after the failing local one never ran').toBe(null);
  });

  test('a local that is neither true nor false is a shape error on a machine and in the cloud: one line, nothing run, 1', () => {
    const marker = 'echo ran >> ran.txt';
    const values = { 'the string "true"': 'true', 'the number 1': 1, 'a word': 'yes', 'an object': {} };
    for (const [name, local] of Object.entries(values)) {
      for (const [where, env] of Object.entries({ machine: {}, cloud: CLOUD })) {
        const w = mkWorld(enabledEntries('afterPublish', [{ command: marker }, { command: marker, local }]));
        const { code, all } = run(w, 'afterPublish', SYSTEM_PATH, env);
        expect(code, `${name}, ${where}: 1, got: ${all}`).toBe(1);
        const got = lines(all);
        expect(got.length, `${name}, ${where}: one line, got: ${all}`).toBe(1);
        expect(got[0].startsWith('ship-hooks: hooks.afterPublish['), `${name}, ${where}: the line names the entry, got: ${got[0]}`).toBeTruthy();
        expect(got[0].endsWith('in the settings has a local that is not true or false, so no afterPublish hook ran'), `${name}, ${where}: the line says what is wrong, got: ${got[0]}`).toBeTruthy();
        expect(w.mark('ran.txt'), `${name}, ${where}: the valid entry before it did not run either`).toBe(null);
      }
    }
  });
});
