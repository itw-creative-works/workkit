// Tests for workflow:bare-call's logic, bareCallVerdict({ command }) in hooks/mods/bare-call.js:
// a kit step (`workkit ship <verb>` for each ALLOWED_SHIP_VERBS entry, `workkit review ...`, `workkit watch ...`) inside
// a compound command, or with a command substitution argument, gets one notice line naming the
// bare form, never a deny; a bare call, a deploy, an unknown verb, a quoted mention and an
// unrelated compound get nothing. The run line is test/mods/guards-bare-call.test.ts.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const NOTE = (step) => `bare-call: run \`${step}\` as its own Bash call from the repo root; inside a compound command it misses its allow rule and auto mode can refuse it.`;

const judge = (command) => mods('bare-call').bareCallVerdict({ command });

/** `command` is never denied and its notice is exactly `lines`, one per step, in order. */
const says = async (command, lines) => {
  const r = await judge(command);
  assertEq(r?.deny, undefined, `never a deny: ${command}`);
  assertEq(textOf(r).replace(/\n$/, ''), lines.join('\n'), `the notice: ${command}`);
};

const cases = async () => {
  group('bare-call: a kit step inside a compound command');

  await test('a cd prefix: cd /w/repo && workkit ship publish names workkit ship publish', async () => {
    await says('cd /w/repo && workkit ship publish', [NOTE('workkit ship publish')]);
  });

  await test('a redirect and a pipe: the step named with the redirect dropped', async () => {
    await says('workkit ship publish 2>&1 | tail -12', [NOTE('workkit ship publish')]);
  });

  await test('a trailing ; echo: the step named with its arguments as written', async () => {
    await says('workkit ship cut 1.2.3; echo done', [NOTE('workkit ship cut 1.2.3')]);
  });

  await test('a review step before && git add -A: workkit review mark full named', async () => {
    await says('workkit review mark full && git add -A', [NOTE('workkit review mark full')]);
  });

  await test('a watch step behind a cd prefix: cd pkg && workkit watch --end names workkit watch --end', async () => {
    await says('cd pkg && workkit watch --end', [NOTE('workkit watch --end')]);
  });

  await test('a quoted argument is named as written: ls && workkit review mark "full"', async () => {
    await says('ls && workkit review mark "full"', [NOTE('workkit review mark "full"')]);
  });

  await test('a command substitution argument: the step is named up to it, and the notice still fires', async () => {
    await says('workkit ship cut $(cat VERSION)', [NOTE('workkit ship cut')]);
  });

  await test('a substitution inside double quotes reads as the unquoted one, even as the whole command', async () => {
    for (const c of ['workkit ship cut "$(cat VERSION)"', 'workkit ship cut "`cat VERSION`"', 'workkit ship cut "v$(cat VERSION)"']) {
      await says(c, [NOTE('workkit ship cut')]);
    }
  });

  await test('a quoted substitution mid-arguments: the step stops before it, its later arguments dropped', async () => {
    await says('cd . && workkit ship release "$(cat VERSION)" --keep 3', [NOTE('workkit ship release')]);
  });

  await test('every allow-listed ship verb behind a cd prefix is named', async () => {
    for (const v of mods('bare-call').ALLOWED_SHIP_VERBS) await says(`cd . && workkit ship ${v}`, [NOTE(`workkit ship ${v}`)]);
  });

  await test('an assignment prefix breaks the rule\'s match too: FOO=1 workkit ship plan names workkit ship plan', async () => {
    await says('FOO=1 workkit ship plan', [NOTE('workkit ship plan')]);
  });

  await test('two kit steps in one compound: two lines, one per step, in order', async () => {
    await says('workkit ship plan && workkit ship publish', [NOTE('workkit ship plan'), NOTE('workkit ship publish')]);
  });

  group('bare-call: nothing to say');

  await test('a bare kit call, with or without blanks around it: nothing', async () => {
    for (const c of ['workkit ship publish', 'workkit ship watch abc1234', 'workkit review covers', 'workkit watch --end run',
      '  workkit ship publish  ', ' workkit ship watch abc1234', 'workkit review covers   ']) {
      await says(c, []);
    }
  });

  await test('workkit ship deploy inside a compound: nothing, deploy has no allow rule', async () => {
    for (const c of ['workkit ship deploy | tail -3', 'cd . && workkit ship deploy']) await says(c, []);
  });

  await test('a ship word outside the verb list inside a compound is no kit step: nothing', async () => {
    for (const c of ['workkit ship --help | head', 'cd . && workkit ship nosuch']) await says(c, []);
  });

  await test('a single-quoted substitution is literal and a bare quoted argument is a bare call: nothing', async () => {
    for (const c of ["workkit ship cut '$(cat VERSION)'", 'workkit ship cut "1.2.3"', 'workkit review mark "full"']) await says(c, []);
  });

  await test('a quoted mention and a compound with no kit step: nothing', async () => {
    for (const c of ['echo "workkit ship publish" | cat', 'git status && npm test']) await says(c, []);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
