// Tests for safety:findings-guard's logic, findingsGuardVerdict({ command,
// cwd, route }) in hooks/mods/findings-guard.js: a `gh issue create` whose
// title starts "review notes from" bounces unless findings.file reads true,
// `route` being findingsRoute's answer over the repo and machine settings.
// Each case ports the HEAD case its name quotes. Dropped with the shell: "no
// jq on PATH". The settings reads are test/mods/guards-findings-guard.test.ts.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const CWD = '/w/repo';
const CREATE = 'gh issue create --title "review notes from the 0.19.0 ship" --body "..."';
const BLOCK = "findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo.\nSay findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own. findings.file: true in the settings file (the repo's .workkit/settings.json, or ~/.workkit/settings.json) turns filing on.";

// The verdict with the route the two settings files give (each parsed, null when absent).
const judge = (command, { repo = null, user = null } = {}) => mods('findings-guard').findingsGuardVerdict({
  command, cwd: CWD, route: mods('settings').findingsRoute(repo, user),
});
const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const bounces = async (command, layers, what) => assertEq(denyOf(await judge(command, layers)), BLOCK, `${what} must bounce`);
const passes = async (command, layers, what) => {
  const r = await judge(command, layers);
  assertEq(denyOf(r), null, `${what} must pass`);
  assertEq(textOf(r), '', `${what} passes silently`);
};

const NO_KEY = { user: { version: 1 }, repo: { version: 1, enabled: true } };

const cases = async () => {
  group('findings-guard: a review-notes create while findings.file is off');

  await test('ports "no findings.file key in either file: the create bounces, naming the chat route and the toggle"', async () => {
    await bounces(CREATE, NO_KEY, 'the review-notes create');
  });

  await test('ports "findings.file false in the global file: the same create bounces"', async () => {
    await bounces(CREATE, { user: { findings: { file: false } } }, 'a create under a global false');
  });

  await test('ports "findings.file true in the global file and no repo key: it passes"', async () => {
    await passes(CREATE, { user: { findings: { file: true } }, repo: { version: 1, enabled: true } }, 'a create under a global true');
  });

  await test('ports "true globally and false in the repo file bounces; false globally and true in the repo file passes"', async () => {
    await bounces(CREATE, { user: { findings: { file: true } }, repo: { version: 1, enabled: true, findings: { file: false } } }, 'a create under a repo false');
    await passes(CREATE, { user: { findings: { file: false } }, repo: { version: 1, enabled: true, findings: { file: true } } }, 'a create under a repo true');
  });

  await test('ports "the title through -t in single quotes or --title= bounces, letter case ignored"', async () => {
    await bounces("gh issue create -t 'Review notes from the 0.19.0 ship' --body \"...\"", NO_KEY, 'the -t form');
    await bounces('gh issue create --title="review notes from the 0.19.0 ship" --body "..."', NO_KEY, 'the --title= form');
  });

  await test('ports "a redirect written before the title bounces too: the & of 2>&1 never splits the clause"', async () => {
    await bounces('gh issue create --repo a/b 2>&1 --title "review notes from the 0.19.0 ship"', NO_KEY, 'a 2>&1 before --title');
    await bounces('gh issue create &>/dev/null --title "review notes from the 0.19.0 ship"', NO_KEY, 'an &> before --title');
  });

  group('findings-guard: everything else passes');

  await test('ports "another title, a comment carrying the phrase, or the phrase past the title\'s start: each passes"', async () => {
    await passes('gh issue create --title "feat: a title" --body "..."', NO_KEY, 'a create with another title');
    await passes('gh issue comment 5 --body "review notes from x"', NO_KEY, 'a comment carrying the phrase');
    await passes('gh issue create --title "fix: review notes from the 0.19.0 ship" --body "..."', NO_KEY, 'the phrase past the start');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
