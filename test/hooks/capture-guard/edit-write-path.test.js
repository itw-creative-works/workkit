// Tests for safety:capture-guard's logic on the Edit and Write path and the
// Bash writes: the drain's marker-gated rewrite, the append no marker opens,
// and the finding route each refusal names, handed over as `route`. Each case
// ports the HEAD case its name quotes; reading findings.file for the route is
// the wiring's, in test/mods/guards-capture-guard.test.ts. Shared facts: ./helpers.js.

const {
  group, test, assert, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, FRESH, ROUTE_ON, WRITE, REWRITE, bash, edit, write, denyOf, refuses, allows,
} = require('./helpers');

const run = async () => {
  group('capture-guard: the Edit and Write path');

  await test('ports "editing or writing the capture file with no marker: exit 2": the refusal names the rewrite', async () => {
    await refuses(edit(CAPTURE), REWRITE(), 'Edit');
    await refuses(write(CAPTURE), REWRITE(), 'Write');
    await refuses(edit(`${W}/capture.md`), REWRITE(), 'Edit, relative');
  });

  await test('ports "editing or writing it with a fresh marker: exit 0"', async () => {
    await allows(edit(CAPTURE, { markerAgeS: FRESH }), 'Edit');
    await allows(write(CAPTURE, { markerAgeS: FRESH }), 'Write');
  });

  await test('ports "writing another file in .workkit/: exit 0"', async () => {
    await allows(write(`${REPO}/${W}/agents/session.md`), 'only the capture file is gated');
  });

  group('capture-guard: the agent never adds to the capture file');

  await test('ports "an append into the capture file: exit 2 with and without a marker"', async () => {
    const appends = [
      `echo "- a thought" >> ${W}/capture.md`,
      `echo "- a thought" >>${W}/capture.md`,
      `printf -- '- x\\n' >> "${W}/capture.md"`,
      `echo x | tee -a ${W}/capture.md`,
      `cd ${W} && echo hi >> capture.md`,
    ];
    for (const c of appends) await refuses(bash(c), WRITE(), c);
    for (const c of appends) await refuses(bash(c, { markerAgeS: FRESH }), WRITE(), `with a marker: ${c}`);
  });

  await test('ports "the capture CLI run by the agent: exit 2 with and without a marker"', async () => {
    const captures = [
      'bash ~/.claude/workkit/wk.sh note "a thought"',
      'workkit note "a thought"',
      'wk.sh note the thought',
      'cd /tmp && wk note "a thought"',
    ];
    for (const c of captures) await refuses(bash(c), WRITE(), c);
    for (const c of captures) await refuses(bash(c, { markerAgeS: FRESH }), WRITE(), `with a marker: ${c}`);
  });

  await test('ports "the capture CLI merely named: exit 0"', async () => {
    for (const c of [
      `gh issue create --body 'the owner runs wk.sh note "x" to capture'`,
      'gh issue comment 1 --body "use workkit note for capture"',
      'rg wk.sh note docs/',
    ]) {
      await allows(bash(c), c);
    }
  });

  await test('ports "a rewrite of the capture file: marker-gated like a read"', async () => {
    const rewrites = [
      `echo x > ${W}/capture.md`,
      `echo x | tee ${W}/capture.md`,
      `sed -i '' 's/a/b/' ${W}/capture.md`,
      `perl -pi -e 's/a/b/' ${W}/capture.md`,
    ];
    for (const c of rewrites) await refuses(bash(c), REWRITE(), c);
    for (const c of rewrites) await allows(bash(c, { markerAgeS: FRESH }), `the drain rewrites freely: ${c}`);
  });

  await test('ports "a command redirecting elsewhere while naming the capture file: exit 0"', async () => {
    for (const c of [
      `echo "${W}/capture.md" > /dev/null`,
      `echo "the captures live at ${W}/capture.md" >> notes.txt`,
      `ls -la ${W}/capture.md`,
    ]) {
      await allows(bash(c), c);
    }
  });

  await test('ports "a writer keyword pointed at another file: exit 0"', async () => {
    for (const c of [
      `wc -l ${W}/capture.md | tee -a /tmp/log`,
      `wc -l ${W}/capture.md | tee /tmp/log`,
      `ls ${W}/capture.md; echo hi | tee -a other.log`,
      `ls ${W}/capture.md; sed -i '' s/a/b/ other.txt`,
      `git log --oneline -- ${W}/capture.md | tee changes.log`,
    ]) {
      await allows(bash(c), c);
    }
  });

  await test('ports "the same keywords pointed AT the capture file: still gated"', async () => {
    await refuses(bash(`tee -a ${W}/capture.md`), WRITE(), 'an append is never the agent\'s');
    await refuses(bash(`sed -i '' s/a/b/ ${W}/capture.md`), REWRITE(), 'a rewrite needs the marker');
    await refuses(bash(`tee -a ${W}/capture.md`, { markerAgeS: FRESH }), WRITE(), 'and no marker opens the append');
    await allows(bash(`sed -i '' s/a/b/ ${W}/capture.md`, { markerAgeS: FRESH }), 'while the drain rewrites freely');
  });

  group('capture-guard: where a finding goes instead follows the route');

  // Both refusals carry the route: the write (an append, the capture CLI) and
  // the rewrite with no marker open.
  const denials = (route) => [
    [bash(`echo "- a thought" >> ${W}/capture.md`, { route }), WRITE(route), 'an append'],
    [bash('workkit note "a thought"', { route }), WRITE(route), 'the capture CLI'],
    [bash(`echo x > ${W}/capture.md`, { route }), REWRITE(route), 'a rewrite'],
    [edit(CAPTURE, { route }), REWRITE(route), 'an Edit of the capture file'],
  ];

  await test('ports "findings.file on: the refusal names the status:inbox route"', async () => {
    for (const [call, expected, label] of denials(ROUTE_ON)) {
      const deny = denyOf(await call);
      assertEq(deny, expected, `must block: ${label}`);
      assert(deny.includes('status:inbox'), `points at the issue: ${label}`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
