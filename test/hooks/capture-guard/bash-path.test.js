// Tests for safety:capture-guard's Bash half, its entry on BASH_GUARDS (hooks/mods/guards.js) run with a real io
// over a real repo and a real workflow home: the guard is handed one boolean, whether the command names
// .workkit/capture.md (`namesCapture`, matched by the hooks module), never the text. Named outside a triage run
// (no marker under 30 minutes old) it is refused before it runs; inside one it runs. The match itself, through
// the hooks module, is test/mods/guards-capture-guard.test.ts.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, seeded,
} = require('../../lib/harness');
const { homeEnv, shellPath, spawnSync } = require('../../lib/platform');
const { mods, textOf } = require('../../lib/mods-inputs');
const { ioIn } = require('../../../workflow/lib/io');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');

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

/** A fresh world; `markerAgeS` dates a triage marker for the repo that many seconds back, null leaves none. */
const mkWorld = async ({ markerAgeS = null } = {}) => {
  const dir = mkTmp('wk-capture-bash-');
  seed(dir);
  const repo = path.join(dir, 'repo');
  const workflowHome = path.join(dir, 'home', '.workkit');
  const env = homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH, WORKFLOW_HOME: shellPath(workflowHome) });
  if (markerAgeS !== null) {
    const root = await ioIn(env).top(repo);
    const marker = await mods('markers').triageMarkerPath(root, workflowHome);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '');
    const at = new Date(Date.now() - markerAgeS * 1000);
    fs.utimesSync(marker, at, at);
  }
  return { repo, env };
};

/** The chain's answer for a call from the repo whose command does or does not name the capture file. */
const judged = async (world, namesCapture) => {
  const entry = mods('guards').BASH_GUARDS.filter((g) => g.hook === HOOK);
  expect(entry.length, `${HOOK} is on the Bash chain once`).toBe(1);
  return mods('guards').runChain(ioIn(world.env), world.env, entry, { cwd: world.repo, background: false, namesCapture });
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
