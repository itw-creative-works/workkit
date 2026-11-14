// Tests for standards.sh: branch protection.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const { stubTool, spawnSync } = require('../../lib/platform');
const { cleanup, makeRepo, makeGhStub, readFile, ghCalls, runScript } = require('./helpers');
const { OLD_CHECKS } = require('../../lib/checks-template');

const TEMPLATE = path.join(__dirname, '..', '..', '..', 'workflow', 'templates', 'github-workflows', 'checks.yml');

// A protection as GitHub answers it: `test` from Actions beside a check of the repo's own.
const PROTECTED = JSON.stringify({
  required_status_checks: {
    strict: true,
    contexts: ['test', 'lint'],
    checks: [{ context: 'test', app_id: 15368 }, { context: 'lint', app_id: null }],
  },
  enforce_admins: { enabled: true },
});

const kitRepo = () => {
  const repo = makeRepo();
  spawnSync('git', ['remote', 'set-url', 'origin', 'https://example.invalid/acme/workkit.git'], { cwd: repo });
  return repo;
};

describe('standards.sh: branch protection', () => {
  test('asks GitHub to require the caller\'s checks / test check when none is set', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'absent' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(output.includes('protection: main now requires the checks / test check'), `applied, got: ${output}`).toBeTruthy();
    const put = ghCalls(stub).find((c) => c.includes('api') && c.includes('PUT'));
    expect(put, 'a PUT went to the protection endpoint').toBeTruthy();
    expect(put.join(' ').includes('repos/stub/repo/branches/main/protection'), `right endpoint, got: ${put.join(' ')}`).toBeTruthy();
    expect(!ghCalls(stub).some((c) => c[0] === 'repo'), 'the repo is read over REST, never the GraphQL gh repo view a cloud session refuses').toBeTruthy();
    const body = JSON.parse(readFile(path.join(stub.dir, 'put-body.json')));
    expect(JSON.stringify(body.required_status_checks.contexts), 'requires exactly the check the caller reports: its job `checks` running ci.yml\'s `test`').toBe('["checks / test"]');
    expect(body.enforce_admins, 'admins stay exempt, so the direct path keeps working').toBe(false);
    cleanup(repo); cleanup(stub.dir);
  });

  test('a GET that fails for any reason but 404 writes nothing', () => {
    // "protected but unreadable" (rate limit, outage) must not be answered by
    // PUTting the minimal payload over whatever configuration exists.
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'absent' });
    stubTool(stub.binDir, 'gh',
      readFile(path.join(stub.binDir, 'gh'))
        .replace('Branch not protected (HTTP 404)', 'API rate limit exceeded')
        .trimEnd().split('\n'));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit 0').toBe(0);
    expect(!ghCalls(stub).some((c) => c.includes('PUT')), `no PUT after an unexplained GET failure, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('an existing protection is left exactly as found', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(output.includes('protection: main already protected'), `reported as a skip, got: ${output}`).toBeTruthy();
    expect(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT: never overwrites a configured protection').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a rejected protection is a quiet skip, never a failed heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'denied' });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit 0: advisory by design').toBe(0);
    expect(output.includes('protection: not applied'), `says so quietly, got: ${output}`).toBeTruthy();
    expect(!output.includes('not fully standardized'), 'needs_attention untouched').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});

describe('standards.sh: a protection still requiring the copy\'s `test` check', () => {
  const patchOf = (stub) => {
    const file = path.join(stub.dir, 'patch-body.json');
    return fs.existsSync(file) ? JSON.parse(readFile(file)) : null;
  };
  // The caller as the stub repo's main carries it once its heal is pushed.
  const CALLER = fs.readFileSync(TEMPLATE, 'utf8').replace('__DEFAULT_BRANCH__', 'main');

  test('`test` is swapped for `checks / test`, every other check kept, in one line', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: PROTECTED });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const patch = ghCalls(stub).find((c) => c.includes('PATCH'));
    expect(patch && patch.join(' ').includes('repos/stub/repo/branches/main/protection/required_status_checks'),
      `the required checks alone are patched, got: ${JSON.stringify(ghCalls(stub))}`).toBeTruthy();
    expect(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT: the rest of the protection stands').toBeTruthy();
    expect(JSON.stringify(patchOf(stub)), 'test renamed with its app kept, lint kept, an app_id of null left out').toBe('{"checks":[{"context":"checks / test","app_id":15368},{"context":"lint"}]}');
    const said = output.split('\n').filter((l) => l.includes('protection: main'));
    expect(said.length, `one line, got: ${said.join(' | ')}`).toBe(1);
    expect(said[0].includes('now requires checks / test in place of test'), `it says what changed, got: ${said[0]}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a protection already on `checks / test`, or with no `test`, is left as found', () => {
    for (const checks of [['checks / test', 'lint'], ['lint']]) {
      const repo = makeRepo();
      const body = JSON.stringify({ required_status_checks: { strict: false, contexts: checks } });
      const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: body });
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      expect(!ghCalls(stub).some((c) => c.includes('PATCH') || c.includes('PUT')), `${checks}: nothing written, got: ${output}`).toBeTruthy();
      expect(output.includes('protection: main already protected'), `${checks}: a skip, got: ${output}`).toBeTruthy();
      cleanup(repo); cleanup(stub.dir);
    }
  });

  test('a protection naming `test` only in contexts is swapped there, both names never doubled', () => {
    const repo = makeRepo();
    const body = JSON.stringify({ required_status_checks: { contexts: ['test', 'checks / test'] } });
    const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: body });
    runScript(repo, { pathPrefix: stub.binDir });
    expect(JSON.stringify(patchOf(stub)), 'one checks / test').toBe('{"checks":[{"context":"checks / test"}]}');
    cleanup(repo); cleanup(stub.dir);
  });

  test('a refused swap is a warning naming the fix, and flags the run', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: PROTECTED, patchFails: true });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(output.includes('protection: main still requires test, which the kit\'s caller reports as checks / test'), `warned, got: ${output}`).toBeTruthy();
    expect(output.includes('not fully standardized'), 'the run is flagged').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('before main carries the caller (no checks.yml there, or the old copy), protection is left as is', () => {
    for (const remoteChecks of [null, OLD_CHECKS]) {
      const repo = makeRepo();
      const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks, protectionBody: PROTECTED });
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      const what = remoteChecks === null ? 'no checks.yml on main' : 'the old copy on main';
      expect(code, `${what}: exit 0, got: ${output}`).toBe(0);
      expect(!ghCalls(stub).some((c) => c.includes('PATCH') || c.includes('PUT')), `${what}: nothing written`).toBeTruthy();
      expect(!output.includes('in place of test') && !output.includes('still requires test'), `${what}: no swap said, got: ${output}`).toBeTruthy();
      expect(ghCalls(stub).some((c) => c.join(' ').includes('contents/.github/workflows/checks.yml?ref=main')), `${what}: main's file was read`).toBeTruthy();
      cleanup(repo); cleanup(stub.dir);
    }
  });
});

describe('standards.sh: protection in the kit\'s own repo', () => {
  test('the kit asks for `test`, the job its own checks.yml defines', () => {
    const repo = kitRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'absent' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(output.includes('protection: main now requires the test check'), `applied, got: ${output}`).toBeTruthy();
    const body = JSON.parse(readFile(path.join(stub.dir, 'put-body.json')));
    expect(JSON.stringify(body.required_status_checks.contexts), 'the kit keeps test').toBe('["test"]');
    cleanup(repo); cleanup(stub.dir);
  });

  test('the kit\'s protection on `test` is never swapped', () => {
    const repo = kitRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present', protectionBody: PROTECTED });
    runScript(repo, { pathPrefix: stub.binDir });
    expect(!ghCalls(stub).some((c) => c.includes('PATCH')), 'no PATCH in the kit').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});
