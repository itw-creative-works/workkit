// Tests for safety:capture-guard's Bash half, its entry on BASH_GUARDS (hooks/mods/guards.js) run with a real io
// over a real repo and a real workflow home: the guard is handed one boolean, whether the command names
// .workkit/capture.md (`namesCapture`, matched by the hooks module), never the text. Named outside a triage run
// (no marker under 30 minutes old) it is refused before it runs; inside one it runs. The match itself, through
// the hooks module, is test/mods/guards-capture-guard.test.ts. A Read from a drive-letter folder runs its READ_GUARDS
// entry over the same disk, so the marker is looked up for the repo the backslash path names.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, seeded,
} = require('../../lib/harness');
const { homeEnv, shellPath, spawnSync } = require('../../lib/platform');
const { mods, textOf } = require('../../lib/mods-inputs');
const { ioIn } = require('../../../workflow/lib/io');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');
const {
  DRIVE_CWD, DRIVE_TOP, DRIVE_CAPTURE, READ,
} = require('./helpers');

const HOOK = 'safety:capture-guard';

// An opted-in repo holding a capture file, beside an empty home.
const seed = seeded((dir) => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.workkit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home', '.workkit'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
  fs.writeFileSync(path.join(repo, '.workkit', 'capture.md'), '# capture\n\n- a private thought\n');
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8', env: homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH }) });
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
});

// DRIVE_TOP under either slash, whole segments only.
const DRIVE = new RegExp(`^${DRIVE_TOP.replace(/\//g, '[\\\\/]')}(?=[\\\\/]|$)`, 'i');

/** The real io with the repo answering at DRIVE_CWD on any platform: a path under it is the repo's on disk. */
const driveIo = async (repo, env) => {
  const base = ioIn(env);
  const slashed = (p) => p.replace(/\\/g, '/');
  const spellings = [await base.top(repo), fs.realpathSync(repo), repo].map(slashed);
  const onDisk = (p) => (typeof p === 'string' && DRIVE.test(p) ? path.join(repo, ...p.replace(DRIVE, '').split(/[\\/]/)) : p);
  const asDrive = (p) => {
    const at = typeof p === 'string' ? spellings.find((s) => slashed(p) === s || slashed(p).startsWith(`${s}/`)) : null;
    return at ? DRIVE_TOP + slashed(p).slice(at.length) : p;
  };
  const mapped = (fn) => async (p, ...rest) => fn(onDisk(p), ...rest);
  return {
    ...base,
    top: async (dir) => asDrive(await base.top(onDisk(dir))),
    real: async (p) => asDrive(await base.real(onDisk(p))),
    read: mapped(base.read),
    exists: mapped(base.exists),
    list: mapped(base.list),
    stat: mapped(base.stat),
    write: mapped(base.write),
    run: async (argv, init = {}) => base.run(argv.map(onDisk), { ...init, cwd: onDisk(init.cwd) }),
  };
};

/**
 * A fresh world; `markerAgeS` dates a triage marker for the repo that many seconds back, null leaves none.
 * `drive` hands the guard the repo as DRIVE_CWD, through driveIo.
 */
const mkWorld = async ({ markerAgeS = null, drive = false } = {}) => {
  const dir = mkTmp('wk-capture-bash-');
  seed(dir);
  const repo = path.join(dir, 'repo');
  const workflowHome = path.join(dir, 'home', '.workkit');
  const env = homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH, WORKFLOW_HOME: shellPath(workflowHome) });
  const io = drive ? await driveIo(repo, env) : ioIn(env);
  const cwd = drive ? DRIVE_CWD : repo;
  if (markerAgeS !== null) {
    const root = await io.top(cwd);
    const marker = await mods('markers').triageMarkerPath(root, workflowHome);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '');
    const at = new Date(Date.now() - markerAgeS * 1000);
    fs.utimesSync(marker, at, at);
  }
  return { env, io, cwd };
};

/** The chain's answer for a call from the world's folder whose command does or does not name the capture file. */
const judged = async (world, namesCapture) => {
  const entry = mods('guards').BASH_GUARDS.filter((g) => g.hook === HOOK);
  expect(entry.length, `${HOOK} is on the Bash chain once`).toBe(1);
  return mods('guards').runChain(world.io, world.env, entry, { cwd: world.cwd, background: false, namesCapture });
};

/** The Read chain's answer for a Read of the capture file spelled with backslashes, its facts as register.js gathers them. */
const readJudged = async (world) => {
  const entry = mods('guards').READ_GUARDS.filter((g) => g.hook === HOOK);
  expect(entry.length, `${HOOK} is on the Read chain once`).toBe(1);
  const folded = `${DRIVE_TOP}/.workkit/capture.md`;
  return mods('guards').runChain(world.io, world.env, entry, {
    tool: 'Read', input: { file_path: DRIVE_CAPTURE }, cwd: world.cwd, file: folded, typed: folded, dir: `${DRIVE_TOP}/.workkit`, gateDir: world.cwd,
  });
};

const denied = (chain) => (chain && typeof chain.deny === 'string' ? chain.deny : null);

describe('capture-guard: a Bash command naming the capture file', () => {
  test('no triage marker: refused before it runs', async () => {
    const deny = denied(await judged(await mkWorld(), true));
    expect(deny !== null && deny.startsWith('capture-guard: BLOCKED'), `refused, got: ${deny}`).toBeTruthy();
  });

  test('a marker 31 minutes old is no triage run: refused', async () => {
    const deny = denied(await judged(await mkWorld({ markerAgeS: 31 * 60 }), true));
    expect(deny !== null && deny.startsWith('capture-guard: BLOCKED'), `refused, got: ${deny}`).toBeTruthy();
  });

  test('a fresh marker: it runs', async () => {
    expect(denied(await judged(await mkWorld({ markerAgeS: 0 }), true)), 'no deny').toBe(null);
  });

  test('a command that does not name the capture file runs, saying nothing', async () => {
    const chain = await judged(await mkWorld(), false);
    expect(denied(chain), 'no deny').toBe(null);
    expect(textOf(chain.notice), 'nothing said').toBe('');
  });
});

describe('capture-guard: the same call from a drive-letter folder', () => {
  test('a fresh marker for that repo: it runs', async () => {
    const chain = await judged(await mkWorld({ markerAgeS: 0, drive: true }), true);
    expect(chain.fires, 'the guard ran, never stood down').toEqual([[HOOK, 'run']]);
    expect(denied(chain), 'no deny').toBe(null);
  });

  test('no marker: refused before it runs', async () => {
    const deny = denied(await judged(await mkWorld({ drive: true }), true));
    expect(deny !== null && deny.startsWith('capture-guard: BLOCKED'), `refused, got: ${deny}`).toBeTruthy();
  });
});

describe('capture-guard: a Read of the capture file spelled with backslashes, from a drive-letter folder', () => {
  // The refusal with no marker shows the Read is gated here, so the pass is the marker's.
  test('a fresh marker for that repo lets it run; none refuses it', async () => {
    const without = denied(await readJudged(await mkWorld({ drive: true })));
    expect(without?.replace(/\n$/, ''), 'no marker: the read refusal').toBe(READ);
    const chain = await readJudged(await mkWorld({ markerAgeS: 0, drive: true }));
    expect(chain.fires, 'the guard ran, never stood down').toEqual([[HOOK, 'run']]);
    expect(denied(chain), 'a fresh marker: no deny').toBe(null);
  });
});
