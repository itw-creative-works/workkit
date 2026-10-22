// Tests for safety:commit-language's logic, commitLanguageVerdict({ command,
// cwd, originless }) in hooks/mods/commit-language.js: a git commit whose
// quoted message uses kill/destroy/dead wording, or whose subject is not
// Conventional Commits or carries a version outside a release commit, is
// denied. Each case ports the HEAD case its name quotes; "malformed JSON:
// exit 0" is dropped with the shell spawn, and the wiring (the originless read
// through git, the chain) is tests/mods/guards-commit-language.test.ts.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

// `originless` is the fact the module gathers: the cwd sits in a repo with no origin.
const judge = (command, { cwd = '/w/repo', originless = false } = {}) => mods('commit-language')
  .commitLanguageVerdict({ command, cwd, originless });

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

// The HEAD hook's stderr, byte for byte: `found` keeps the trailing space its
// word list carried.
const VOCAB = (found) => `commit-language: BLOCKED this commit: the message uses non-neutral vocabulary: ${found} \nReword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, keep it unquoted in the command or rephrase around it.`;
const FORMAT = (subject) => `commit-language: BLOCKED this commit: the subject line is not Conventional Commits: ${subject}\nWrite it as <type>(<scope>): <subject> with type one of feat/fix/docs/chore/refactor/test and a lowercase first word, e.g. fix(hooks): bounce the empty span.`;
const LENGTH = (n) => `commit-language: BLOCKED this commit: the subject line is ${n} characters, over the 72-character limit.\nShorten the subject and move the detail into the commit body.`;
const VERSION = (subject) => `commit-language: BLOCKED this commit: the subject line carries a version number: ${subject}\nOnly the release commit names a version, as chore(release): <x.y.z>. Describe the change instead; the version bump is its own commit.`;

const bounces = async (command, want, facts) => {
  assertEq(denyOf(await judge(command, facts)), want, `must bounce: ${command}`);
};

const passes = async (command, facts) => {
  const r = await judge(command, facts);
  assertEq(denyOf(r), null, `must pass: ${command}`);
  assertEq(textOf(r), '', `silently: ${command}`);
};

const run = async () => {
  group('commit-language: bounced messages');

  await test('ports "kill in -m message: exit 2 with replacement guidance"', async () => {
    await bounces('git commit -m "fix: kill the stuck watcher process"', VOCAB('kill'));
  });

  await test('ports "word variants and case: killed, Destroyed, DEAD all bounce"', async () => {
    for (const [msg, word] of [['killed the daemon', 'killed'], ['Destroyed old config', 'Destroyed'], ['remove DEAD code', 'DEAD']]) {
      await bounces(`git commit -m "chore: ${msg}"`, VOCAB(word));
    }
  });

  await test('ports "HEREDOC body: exit 2"', async () => {
    await bounces('git commit -m "$(cat <<\'EOF\'\nfix(hooks): restart watcher\n\nKills the stale process before relaunch.\nEOF\n)"', VOCAB('Kills'));
  });

  group('commit-language: allowed');

  await test('ports "neutral message: exit 0"', async () => {
    await passes('git commit -m "fix: terminate the stale watcher and remove old config"');
  });

  await test('ports "substring inside longer words (deadline, killarney): exit 0"', async () => {
    await passes('git commit -m "feat: deadline reminder for killarney branch"');
  });

  await test('ports "unquoted file path with listed word: exit 0"', async () => {
    await passes('git add kill-switch.md && git commit -m "docs: describe the hook disable flag"');
  });

  await test('ports "non-commit git command with listed word quoted: exit 0"', async () => {
    await passes('git grep "killed" -- src/');
  });

  await test('ports "mention of git commit inside quotes, no real commit: exit 0"', async () => {
    await passes('echo "run git commit -m kill later"');
  });

  await test('ports "MULTI-LINE quoted mention: exit 0"', async () => {
    await passes('echo "todo list\ngit commit the fix that kills the watcher"');
  });

  await test('ports "heredoc BODY with git commit example and listed word: exit 0"', async () => {
    await passes('cat >> SKILL.md <<\'EOF\'\n- when the gate bounces `git add -A && git commit -m "kill"`, re-stage\nEOF');
  });

  await test('ports "commit inside interpreter-fed heredoc with listed word: exit 2"', async () => {
    await bounces('bash <<\'EOF\'\ngit commit -m "kill the watcher"\nEOF', VOCAB('kill'));
  });

  await test('ports "quote character inside single quotes before a commit with a listed word: exit 2"', async () => {
    await bounces('grep \'"\' notes.txt; git commit -m "kill the watcher"', VOCAB('kill'));
  });

  group('commit-language: the message scope');

  await test('ports "listed word in OTHER quoted text on the line: exit 0"', async () => {
    await passes('git commit -m "docs: tidy" && echo "killing the old server"');
  });

  await test('ports "unquoted message falls back to the whole-command scan: exit 2"', async () => {
    await bounces('git commit -m tidy && echo "killing the old server"', VOCAB('killing'));
  });

  await test('ports "interpreter-string commit with a listed word: exit 2"', async () => {
    await bounces('sh -c \'git commit -m "kill the watcher"\'', VOCAB('kill'));
  });

  await test('ports "interpreter-string commit with a neutral message: exit 0"', async () => {
    await passes('sh -c "git commit -m \'docs: tidy\'"');
  });

  await test('ports "prefixed commit spellings are scanned: env/path"', async () => {
    for (const c of ['env git commit -m "kill the watcher"', '/usr/bin/git commit -m "kill the watcher"']) {
      await bounces(c, VOCAB('kill'));
    }
  });

  await test('ports "unquoted eval commit with a listed word: exit 2"', async () => {
    await bounces('eval git commit -m "kill the watcher"', VOCAB('kill'));
  });

  await test('ports "attached -c string with a listed word: exit 2"', async () => {
    await bounces('bash -c"git commit -m \'kill the watcher\'"', VOCAB('kill'));
  });

  group('commit-language: subject format');

  await test('ports "conventional subject with scope: exit 0"', async () => {
    await passes('git commit -m "feat(hooks): check the subject line format"');
  });

  await test('ports "unknown type: exit 2"', async () => {
    await bounces('git commit -m "feature: check the subject line format"', FORMAT('feature: check the subject line format'));
  });

  await test('ports "uppercase subject start: exit 2"', async () => {
    await bounces('git commit -m "feat: Check the subject line format"', FORMAT('feat: Check the subject line format'));
  });

  await test('ports "no type prefix at all: exit 2"', async () => {
    await bounces('git commit -m "check the subject line format"', FORMAT('check the subject line format'));
  });

  await test('ports "subject over 72 characters: exit 2 naming the length"', async () => {
    await bounces(`git commit -m "feat: ${'a'.repeat(70)}"`, LENGTH(76));
  });

  await test('ports "breaking marker and multi-word scope: exit 0"', async () => {
    await passes('git commit -m "refactor(hooks/safety)!: fold the format check in"');
  });

  await test('ports "version number in a feat subject: exit 2"', async () => {
    await bounces('git commit -m "feat: bump the engine to 1.2.3"', VERSION('feat: bump the engine to 1.2.3'));
  });

  await test('ports "chore(release) subject with a version: exit 0"', async () => {
    for (const s of ['chore(release): 1.2.3', 'chore(release): v0.7.0']) await passes(`git commit -m "${s}"`);
  });

  await test('ports "Merge and Revert subjects pass unexamined: exit 0"', async () => {
    for (const s of ['Merge branch main into topic', 'Revert \\"feat: the thing\\"', 'fixup! feat: the thing']) {
      await passes(`git commit -m "${s}"`);
    }
  });

  await test('ports "HEREDOC message: the subject under the opener is judged (exit 0)"', async () => {
    await passes('git commit -m "$(cat <<\'EOF\'\nfix(hooks): restart the watcher\n\nBody prose, sentence-cased and long.\nEOF\n)"');
  });

  await test('ports "body carries a version, subject does not: exit 0"', async () => {
    await passes('git commit -m "$(cat <<\'EOF\'\nfix(hooks): restart the watcher\n\nRegression since 1.2.3.\nEOF\n)"');
  });

  await test('ports "fallback path does NOT format-judge a quoted span: exit 0"', async () => {
    await passes('git commit -m tidy && echo "all done here"');
  });

  await test('ports "fallback path still runs the vocabulary scan: exit 2"', async () => {
    await bounces('git commit -m tidy && echo "killing the old server"', VOCAB('killing'));
  });

  group('commit-language: subject format hardening');

  await test('ports "command-substitution subject that is not the heredoc idiom: exit 0"', async () => {
    await passes('git commit -m "$(cat /tmp/msg.txt)"');
  });

  await test('ports "flag-shaped span BEFORE the commit is not judged as the subject: exit 0"', async () => {
    await passes('grep -F "Some Thing" f && git commit -m "feat: fine"');
  });

  await test('ports "the real subject after the commit token is still judged: exit 2"', async () => {
    await bounces('grep -F "Some Thing" f && git commit -m "feat: Bad subject start"', FORMAT('feat: Bad subject start'));
  });

  await test('ports "two -m flags with "commit" in the subject: the FIRST is the subject (exit 0)"', async () => {
    await passes('git commit -m "fix(hooks): scan the commit message" -m "Body here."');
  });

  await test('ports "two -m flags, the SUBJECT itself is bad: exit 2"', async () => {
    await bounces('git commit -m "Scan the commit message" -m "Body here."', FORMAT('Scan the commit message'));
  });

  await test('ports "72 characters of multi-byte text under LC_ALL=C: exit 0": characters, not bytes', async () => {
    const subject = `feat: ${'a'.repeat(62)} ${String.fromCharCode(0x2026)} b`;
    assertEq([...subject].length, 72, 'the fixture is exactly at the limit');
    await passes(`git commit -m "${subject}"`);
  });

  await test('ports "leading whitespace is trimmed before judging: exit 0"', async () => {
    await passes('git commit -m "  feat(hooks): trim the subject first"');
  });

  group('commit-language: a repo with no origin');

  await test('ports "cwd in a repo with no origin, bad subject: exit 0 and silent"', async () => {
    await passes('git commit -m "pub 1"', { originless: true });
  });

  await test('ports "cwd in a repo with an origin, bad subject: exit 2 as today"', async () => {
    await bounces('git commit -m "pub 1"', FORMAT('pub 1'), { originless: false });
  });

  await test('ports "no cwd in the payload, run from a repo with no origin: still lints (exit 2)"', async () => {
    await bounces('git commit -m "pub 1"', FORMAT('pub 1'), { cwd: '', originless: false });
  });

  group('commit-language: fail-open');

  await test('ports "missing command: exit 0": an empty command is silence', async () => {
    await passes('');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
