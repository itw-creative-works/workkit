// Tests for hooks/mods/gh.js, the one home of the gh reads the guards share:
// issueView(run, n, fields, { repo }) and buildingList(run, { repo }), over a
// recording `run`: the argv each builds, with and without --repo, and the answer
// handed back, gh's text on success and null when gh fails.

const { describe, test, expect } = require('../lib/harness');
const { mods, runResult } = require('../lib/mods-inputs');

// A run that records each argv and answers `result`.
const recorder = (result = runResult({ stdout: '{"ok":true}\n' })) => {
  const calls = [];
  const answer = async (argv, init) => { calls.push({ argv: [...argv], init }); return result; };
  return { run: answer, calls };
};

// The argv after the program, whatever spelling of gh it was run as.
const argsOf = (call) => {
  expect(call.argv[0].split(/[\\/]/).pop().replace(/\.exe$/, ''), `the program is gh, got: ${call.argv[0]}`).toBe('gh');
  return call.argv.slice(1);
};

// The value after a flag, undefined when the flag is not there.
const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

describe('gh.js: issueView', () => {
  test('issueView asks gh issue view <n> --json <fields>, with no --repo when none is given', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').issueView(r, 12, 'state,labels,comments,url', {});
    expect(calls.length, 'one gh call').toBe(1);
    const args = argsOf(calls[0]);
    expect(args.slice(0, 3).join(' '), `the view of the number, got: ${args.join(' ')}`).toBe('issue view 12');
    expect(flag(args, '--json'), 'the fields asked for').toBe('state,labels,comments,url');
    expect(!args.includes('--repo') && !args.includes('-R'), `no repo named, got: ${args.join(' ')}`).toBeTruthy();
  });

  test('issueView with a repo adds --repo <owner/name>', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').issueView(r, 7, 'body', { repo: 'acme/widgets' });
    const args = argsOf(calls[0]);
    expect(args.slice(0, 3).join(' '), `the view of the number, got: ${args.join(' ')}`).toBe('issue view 7');
    expect(flag(args, '--repo'), `the repo, got: ${args.join(' ')}`).toBe('acme/widgets');
  });

  test("issueView answers gh's text, and null when gh fails", async () => {
    expect(await mods('gh').issueView(recorder().run, 12, 'body', {}), 'the view as gh printed it').toBe('{"ok":true}\n');
    const failed = recorder(runResult({ exitCode: 1, stderr: 'GraphQL: Could not resolve to an issue\n' }));
    expect(await mods('gh').issueView(failed.run, 12, 'body', {}), 'a failed view is null').toBe(null);
  });
});

describe('gh.js: buildingList', () => {
  test('buildingList asks gh issue list --state open --label status:building, with no --repo when none is given', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').buildingList(r, {});
    expect(calls.length, 'one gh call').toBe(1);
    const args = argsOf(calls[0]);
    expect(args.slice(0, 2).join(' '), `the issue list, got: ${args.join(' ')}`).toBe('issue list');
    expect(flag(args, '--state'), 'open issues').toBe('open');
    expect(flag(args, '--label'), 'at status:building').toBe('status:building');
    expect(!args.includes('--repo') && !args.includes('-R'), `no repo named, got: ${args.join(' ')}`).toBeTruthy();
  });

  test('buildingList with a repo adds --repo <owner/name>', async () => {
    const { run: r, calls } = recorder();
    await mods('gh').buildingList(r, { repo: 'acme/widgets' });
    const args = argsOf(calls[0]);
    expect(flag(args, '--label'), 'at status:building').toBe('status:building');
    expect(flag(args, '--repo'), `the repo, got: ${args.join(' ')}`).toBe('acme/widgets');
  });

  test("buildingList answers gh's text, and null when gh fails", async () => {
    expect(await mods('gh').buildingList(recorder().run, {}), 'the list as gh printed it').toBe('{"ok":true}\n');
    const failed = recorder(runResult({ exitCode: 1, stderr: 'error connecting to api.github.com\n' }));
    expect(await mods('gh').buildingList(failed.run, {}), 'a failed list is null').toBe(null);
  });
});
