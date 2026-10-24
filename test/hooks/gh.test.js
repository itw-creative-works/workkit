// Tests for hooks/mods/gh.js, the one home of the gh reads the guards share:
// issueView(run, n, fields, { repo }) and buildingList(run, { repo }), over a
// recording `run`: the argv each builds, with and without --repo, and the answer
// handed back, gh's text on success and null when gh fails.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, runResult } = require('../lib/mods-inputs');

// A run that records each argv and answers `result`.
const recorder = (result = runResult({ stdout: '{"ok":true}\n' })) => {
  const calls = [];
  const run = async (argv, init) => { calls.push({ argv: [...argv], init }); return result; };
  return { run, calls };
};

// The argv after the program, whatever spelling of gh it was run as.
const argsOf = (call) => {
  assertEq(call.argv[0].split(/[\\/]/).pop().replace(/\.exe$/, ''), 'gh', `the program is gh, got: ${call.argv[0]}`);
  return call.argv.slice(1);
};

// The value after a flag, undefined when the flag is not there.
const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const run = async () => {
  group('gh.js: issueView');

  await test('issueView asks gh issue view <n> --json <fields>, with no --repo when none is given', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').issueView(r, 12, 'state,labels,comments,url', {});
    assertEq(calls.length, 1, 'one gh call');
    const args = argsOf(calls[0]);
    assertEq(args.slice(0, 3).join(' '), 'issue view 12', `the view of the number, got: ${args.join(' ')}`);
    assertEq(flag(args, '--json'), 'state,labels,comments,url', 'the fields asked for');
    assert(!args.includes('--repo') && !args.includes('-R'), `no repo named, got: ${args.join(' ')}`);
  });

  await test('issueView with a repo adds --repo <owner/name>', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').issueView(r, 7, 'body', { repo: 'acme/widgets' });
    const args = argsOf(calls[0]);
    assertEq(args.slice(0, 3).join(' '), 'issue view 7', `the view of the number, got: ${args.join(' ')}`);
    assertEq(flag(args, '--repo'), 'acme/widgets', `the repo, got: ${args.join(' ')}`);
  });

  await test("issueView answers gh's text, and null when gh fails", async () => {
    assertEq(await mods('gh').issueView(recorder().run, 12, 'body', {}), '{"ok":true}\n', 'the view as gh printed it');
    const failed = recorder(runResult({ exitCode: 1, stderr: 'GraphQL: Could not resolve to an issue\n' }));
    assertEq(await mods('gh').issueView(failed.run, 12, 'body', {}), null, 'a failed view is null');
  });

  group('gh.js: buildingList');

  await test('buildingList asks gh issue list --state open --label status:building, with no --repo when none is given', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').buildingList(r, {});
    assertEq(calls.length, 1, 'one gh call');
    const args = argsOf(calls[0]);
    assertEq(args.slice(0, 2).join(' '), 'issue list', `the issue list, got: ${args.join(' ')}`);
    assertEq(flag(args, '--state'), 'open', 'open issues');
    assertEq(flag(args, '--label'), 'status:building', 'at status:building');
    assert(!args.includes('--repo') && !args.includes('-R'), `no repo named, got: ${args.join(' ')}`);
  });

  await test('buildingList with a repo adds --repo <owner/name>', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').buildingList(r, { repo: 'acme/widgets' });
    const args = argsOf(calls[0]);
    assertEq(flag(args, '--label'), 'status:building', 'at status:building');
    assertEq(flag(args, '--repo'), 'acme/widgets', `the repo, got: ${args.join(' ')}`);
  });

  await test("buildingList answers gh's text, and null when gh fails", async () => {
    assertEq(await mods('gh').buildingList(recorder().run, {}), '{"ok":true}\n', 'the list as gh printed it');
    const failed = recorder(runResult({ exitCode: 1, stderr: 'error connecting to api.github.com\n' }));
    assertEq(await mods('gh').buildingList(failed.run, {}), null, 'a failed list is null');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
