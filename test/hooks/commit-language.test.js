// Tests for safety:commit-language's logic, commitLanguageVerdict(message) in hooks/mods/commit-language.js,
// over the real commit message the commit-msg hook reads: one whose wording is kill/destroy/dead, or whose
// subject is not Conventional Commits or carries a version outside a release commit, is denied. The real
// commit-msg run is test/scripts/githooks.test.js.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const judge = (message) => mods('commit-language').commitLanguageVerdict(message);

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

// The HEAD hook's stderr, byte for byte: `found` keeps the trailing space its
// word list carried.
const VOCAB = (found) => `commit-language: BLOCKED this commit: the message uses non-neutral vocabulary: ${found} \nReword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, rephrase the message around it: the hook reads the message git commits, so quoting the word does not hide it.`;
const FORMAT = (subject) => `commit-language: BLOCKED this commit: the subject line is not Conventional Commits: ${subject}\nWrite it as <type>(<scope>): <subject> with type one of feat/fix/docs/chore/refactor/test and a lowercase first word, e.g. fix(hooks): bounce the empty span.`;
const LENGTH = (n) => `commit-language: BLOCKED this commit: the subject line is ${n} characters, over the 72-character limit.\nShorten the subject and move the detail into the commit body.`;
const VERSION = (subject) => `commit-language: BLOCKED this commit: the subject line carries a version number: ${subject}\nOnly the release commit names a version, as chore(release): <x.y.z>. Describe the change instead; the version bump is its own commit.`;

const bounces = async (message, want) => {
  expect(denyOf(await judge(message)), `must bounce: ${message}`).toBe(want);
};

const passes = async (message) => {
  const r = await judge(message);
  expect(denyOf(r), `must pass: ${message}`).toBe(null);
  expect(textOf(r), `silently: ${message}`).toBe('');
};

describe('commit-language: bounced messages', () => {
  test('kill in -m message: exit 2 with replacement guidance', async () => {
    await bounces('fix: kill the stuck watcher process', VOCAB('kill'));
  });

  test('word variants and case: killed, Destroyed, DEAD all bounce', async () => {
    for (const [msg, word] of [['killed the daemon', 'killed'], ['Destroyed old config', 'Destroyed'], ['remove DEAD code', 'DEAD']]) {
      await bounces(`chore: ${msg}`, VOCAB(word));
    }
  });

  test('HEREDOC body: exit 2: a listed word in the body', async () => {
    await bounces('fix(hooks): restart watcher\n\nKills the stale process before relaunch.', VOCAB('Kills'));
  });
});

describe('commit-language: allowed', () => {
  test('neutral message: exit 0', async () => {
    await passes('fix: terminate the stale watcher and remove old config');
  });

  test('substring inside longer words (deadline, killarney): exit 0', async () => {
    await passes('feat: deadline reminder for killarney branch');
  });
});

describe('commit-language: subject format', () => {
  test('conventional subject with scope: exit 0', async () => {
    await passes('feat(hooks): check the subject line format');
  });

  test('unknown type: exit 2', async () => {
    await bounces('feature: check the subject line format', FORMAT('feature: check the subject line format'));
  });

  test('uppercase subject start: exit 2', async () => {
    await bounces('feat: Check the subject line format', FORMAT('feat: Check the subject line format'));
  });

  test('no type prefix at all: exit 2', async () => {
    await bounces('check the subject line format', FORMAT('check the subject line format'));
  });

  test('subject over 72 characters: exit 2 naming the length', async () => {
    await bounces(`feat: ${'a'.repeat(70)}`, LENGTH(76));
  });

  test('breaking marker and multi-word scope: exit 0', async () => {
    await passes('refactor(hooks/safety)!: fold the format check in');
  });

  test('version number in a feat subject: exit 2', async () => {
    await bounces('feat: bump the engine to 1.2.3', VERSION('feat: bump the engine to 1.2.3'));
  });

  test('chore(release) subject with a version: exit 0', async () => {
    for (const s of ['chore(release): 1.2.3', 'chore(release): v0.7.0']) await passes(s);
  });

  test('Merge and Revert subjects pass unexamined: exit 0', async () => {
    for (const s of ['Merge branch main into topic', 'Revert "feat: the thing"', 'fixup! feat: the thing']) {
      await passes(s);
    }
  });

  test('HEREDOC message: the subject under the opener is judged (exit 0): the first line is the subject', async () => {
    await passes('fix(hooks): restart the watcher\n\nBody prose, sentence-cased and long.');
  });

  test('body carries a version, subject does not: exit 0', async () => {
    await passes('fix(hooks): restart the watcher\n\nRegression since 1.2.3.');
  });
});

describe('commit-language: subject format hardening', () => {
  test('two -m flags with "commit" in the subject: the FIRST is the subject (exit 0)', async () => {
    await passes('fix(hooks): scan the commit message\n\nBody here.');
  });

  test('two -m flags, the SUBJECT itself is bad: exit 2', async () => {
    await bounces('Scan the commit message\n\nBody here.', FORMAT('Scan the commit message'));
  });

  test('72 characters of multi-byte text under LC_ALL=C: exit 0: characters, not bytes', async () => {
    const subject = `feat: ${'a'.repeat(62)} ${String.fromCharCode(0x2026)} b`;
    expect([...subject].length, 'the fixture is exactly at the limit').toBe(72);
    await passes(subject);
  });

  test('leading whitespace is trimmed before judging: exit 0', async () => {
    await passes('  feat(hooks): trim the subject first');
  });
});
