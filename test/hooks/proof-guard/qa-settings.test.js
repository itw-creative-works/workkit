// Tests for safety:proof-guard's flip to status:qa over the `settingsFaults` fact:
// a settings value the merge set aside rides the flip's notes when it names the
// repo's own settings file or the proof key, on a pass and beside a block alike,
// and any other fault stays out of them; through the real facts, a repo file's fault reaches the flip.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { mkRepo } = require('../../lib/script-shell');
const {
  ROOT, packagesOf, pkgRecord, judge, denyOf, QA, QA_BLOCK, assertBlocks, passText, flip: realFlip, sessionOf,
} = require('./helpers');

const BACKEND = 'packages/backend';
const TOUCHED = [`${BACKEND}/test/a.test.js`];
const BLOCKED = QA_BLOCK(1, `${BACKEND}: test/a.test.js`);

const REPO_FILE = `${ROOT}/.workkit/settings.json`;
const MACHINE_FILE = '/w/home/.workkit/settings.json';
// Faults as settingsFaults answers them: the file, the dotted key (null for the whole file), the line.
const PROOF_FAULT = { file: REPO_FILE, key: 'proof', line: `${REPO_FILE}: proof is not an object, so the value below it stands` };
const REPO_BROKEN = { file: REPO_FILE, key: null, line: `${REPO_FILE} is not a JSON object, so it adds nothing` };
const MACHINE_PROOF = { file: MACHINE_FILE, key: 'proof', line: `${MACHINE_FILE}: proof is not an object, so the value below it stands` };
const MACHINE_MANAGER = { file: MACHINE_FILE, key: 'manager', line: `${MACHINE_FILE}: manager is not an object, so the value below it stands` };

// A committed repo whose `.workkit/settings.json` text is <text>, its root test file edited, no record planted.
const settingsWorld = (prefix, text) => {
  const dir = mkRepo({ scripts: { test: 'node test/a.test.js' } }, { '.workkit/settings.json': text, 'test/a.test.js': '// a\n' });
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), '// a\n// b\n');
  return sessionOf(dir, `${prefix}home-`);
};

/** The flip over the one touched backend file, `proved` saying whether its package record is there. */
const flip = (settingsFaults, proved) => judge(QA, {
  touched: TOUCHED,
  packages: packagesOf([BACKEND]),
  packageRecord: proved ? pkgRecord([BACKEND]) : null,
  settingsFaults,
});

describe('proof-guard: a settings value the merge set aside rides the qa flip', () => {
  test('case 8: every package proved and a fault on the repo file or the proof key: the flip passes, its context carrying the line', async () => {
    for (const fault of [PROOF_FAULT, REPO_BROKEN, MACHINE_PROOF]) {
      const msg = passText(await flip([fault], true), fault.line);
      expect(msg.includes(fault.line), `the context carries the line, got: ${msg}`).toBeTruthy();
    }
  });

  test('case 9: the same fault on a flip that blocks: the deny is the block, the line beside it', async () => {
    const deny = denyOf(await flip([PROOF_FAULT], false)) || '';
    expect(deny.startsWith(`${BLOCKED}\n`), `the block first, got: ${deny}`).toBeTruthy();
    expect(deny.includes(PROOF_FAULT.line), `the deny carries the line, got: ${deny}`).toBeTruthy();
  });

  test('case 10: a fault on manager from the machine file alone: neither the pass nor the block carries it', async () => {
    const msg = passText(await flip([MACHINE_MANAGER], true), 'proved');
    expect(!msg.includes(MACHINE_MANAGER.line), `the context leaves it out, got: ${msg}`).toBeTruthy();
    assertBlocks(await flip([MACHINE_MANAGER], false), BLOCKED, 'the block alone');
  });
});

describe('proof-guard: a repo file the merge set aside, through the real facts', () => {
  test('a repo file whose proof is a list: the blocked flip names the file and proof, a sentence beside the block', async () => {
    const { dir, env, root } = settingsWorld('qa-settings-list-', '{"enabled": true, "proof": ["backend"]}');
    assertBlocks(await realFlip(dir, env),
      QA_BLOCK(1, 'the repo root: test/a.test.js', `${root}/.workkit/settings.json: proof is not an object, so the value below it stands.`),
      'the proof fault rides the deny');
  });

  test('a repo file that does not parse: the blocked flip says it adds nothing, a sentence beside the block', async () => {
    const { dir, env, root } = settingsWorld('qa-settings-broken-', '{ not json');
    assertBlocks(await realFlip(dir, env),
      QA_BLOCK(1, 'the repo root: test/a.test.js', `${root}/.workkit/settings.json is not a JSON object, so it adds nothing.`),
      'the broken file rides the deny');
  });
});
