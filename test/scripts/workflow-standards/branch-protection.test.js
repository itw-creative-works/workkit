// Tests for standards.sh: branch protection.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { stubTool, spawnSync } = require('../../lib/platform');
const { cleanup, makeRepo, makeGhStub, readFile, ghCalls, runScript } = require('./helpers');
const { OLD_CHECKS } = require('../../lib/checks-template');

const TEMPLATE = path.join(__dirname, '..', '..', '..', 'workflow', 'templates', 'github-workflows', 'checks.yml');

const cases = async () => {
  group('standards.sh: branch protection');

  await test('asks GitHub to require the caller\'s checks / test check when none is set', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'absent' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main now requires the checks / test check'), `applied, got: ${output}`);
    const put = ghCalls(stub).find((c) => c.includes('api') && c.includes('PUT'));
    assert(put, 'a PUT went to the protection endpoint');
    assert(put.join(' ').includes('repos/stub/repo/branches/main/protection'), `right endpoint, got: ${put.join(' ')}`);
    assert(!ghCalls(stub).some((c) => c[0] === 'repo'), 'the repo is read over REST, never the GraphQL gh repo view a cloud session refuses');
    const body = JSON.parse(readFile(path.join(stub.dir, 'put-body.json')));
    assertEq(JSON.stringify(body.required_status_checks.contexts), '["checks / test"]',
      'requires exactly the check the caller reports: its job `checks` running ci.yml\'s `test`');
    assertEq(body.enforce_admins, false, 'admins stay exempt, so the direct path keeps working');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a GET that fails for any reason but 404 writes nothing', () => {
    // "protected but unreadable" (rate limit, outage) must not be answered by
    // PUTting the minimal payload over whatever configuration exists.
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'absent' });
    stubTool(stub.binDir, 'gh',
      readFile(path.join(stub.binDir, 'gh'))
        .replace('Branch not protected (HTTP 404)', 'API rate limit exceeded')
        .trimEnd().split('\n'));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), `no PUT after an unexplained GET failure, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('an existing protection is left exactly as found', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main already protected'), `reported as a skip, got: ${output}`);
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT: never overwrites a configured protection');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a rejected protection is a quiet skip, never a failed heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'denied' });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0: advisory by design');
    assert(output.includes('protection: not applied'), `says so quietly, got: ${output}`);
    assert(!output.includes('not fully standardized'), 'needs_attention untouched');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: a protection still requiring the copy\'s `test` check');

  // A protection as GitHub answers it: `test` from Actions beside a check of the repo's own.
  const PROTECTED = JSON.stringify({
    required_status_checks: {
      strict: true,
      contexts: ['test', 'lint'],
      checks: [{ context: 'test', app_id: 15368 }, { context: 'lint', app_id: null }],
    },
    enforce_admins: { enabled: true },
  });
  const patchOf = (stub) => {
    const file = path.join(stub.dir, 'patch-body.json');
    return fs.existsSync(file) ? JSON.parse(readFile(file)) : null;
  };
  // The caller as the stub repo's main carries it once its heal is pushed.
  const CALLER = fs.readFileSync(TEMPLATE, 'utf8').replace('__DEFAULT_BRANCH__', 'main');
  const kitRepo = () => {
    const repo = makeRepo();
    spawnSync('git', ['remote', 'set-url', 'origin', 'https://example.invalid/acme/workkit.git'], { cwd: repo });
    return repo;
  };

  await test('`test` is swapped for `checks / test`, every other check kept, in one line', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: PROTECTED });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    const patch = ghCalls(stub).find((c) => c.includes('PATCH'));
    assert(patch && patch.join(' ').includes('repos/stub/repo/branches/main/protection/required_status_checks'),
      `the required checks alone are patched, got: ${JSON.stringify(ghCalls(stub))}`);
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT: the rest of the protection stands');
    assertEq(JSON.stringify(patchOf(stub)), '{"checks":[{"context":"checks / test","app_id":15368},{"context":"lint"}]}',
      'test renamed with its app kept, lint kept, an app_id of null left out');
    const said = output.split('\n').filter((l) => l.includes('protection: main'));
    assertEq(said.length, 1, `one line, got: ${said.join(' | ')}`);
    assert(said[0].includes('now requires checks / test in place of test'), `it says what changed, got: ${said[0]}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a protection already on `checks / test`, or with no `test`, is left as found', () => {
    for (const checks of [['checks / test', 'lint'], ['lint']]) {
      const repo = makeRepo();
      const body = JSON.stringify({ required_status_checks: { strict: false, contexts: checks } });
      const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: body });
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      assert(!ghCalls(stub).some((c) => c.includes('PATCH') || c.includes('PUT')), `${checks}: nothing written, got: ${output}`);
      assert(output.includes('protection: main already protected'), `${checks}: a skip, got: ${output}`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  await test('a protection naming `test` only in contexts is swapped there, both names never doubled', () => {
    const repo = makeRepo();
    const body = JSON.stringify({ required_status_checks: { contexts: ['test', 'checks / test'] } });
    const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: body });
    runScript(repo, { pathPrefix: stub.binDir });
    assertEq(JSON.stringify(patchOf(stub)), '{"checks":[{"context":"checks / test"}]}', 'one checks / test');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a refused swap is a warning naming the fix, and flags the run', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks: CALLER, protectionBody: PROTECTED, patchFails: true });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main still requires test, which the kit\'s caller reports as checks / test'), `warned, got: ${output}`);
    assert(output.includes('not fully standardized'), 'the run is flagged');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('before main carries the caller (no checks.yml there, or the old copy), protection is left as is', () => {
    for (const remoteChecks of [null, OLD_CHECKS]) {
      const repo = makeRepo();
      const stub = makeGhStub({ repoRead: true, protection: 'present', remoteChecks, protectionBody: PROTECTED });
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      const what = remoteChecks === null ? 'no checks.yml on main' : 'the old copy on main';
      assertEq(code, 0, `${what}: exit 0, got: ${output}`);
      assert(!ghCalls(stub).some((c) => c.includes('PATCH') || c.includes('PUT')), `${what}: nothing written`);
      assert(!output.includes('in place of test') && !output.includes('still requires test'), `${what}: no swap said, got: ${output}`);
      assert(ghCalls(stub).some((c) => c.join(' ').includes('contents/.github/workflows/checks.yml?ref=main')), `${what}: main's file was read`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  group('standards.sh: protection in the kit\'s own repo');

  await test('the kit asks for `test`, the job its own checks.yml defines', () => {
    const repo = kitRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'absent' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main now requires the test check'), `applied, got: ${output}`);
    const body = JSON.parse(readFile(path.join(stub.dir, 'put-body.json')));
    assertEq(JSON.stringify(body.required_status_checks.contexts), '["test"]', 'the kit keeps test');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the kit\'s protection on `test` is never swapped', () => {
    const repo = kitRepo();
    const stub = makeGhStub({ repoRead: true, protection: 'present', protectionBody: PROTECTED });
    runScript(repo, { pathPrefix: stub.binDir });
    assert(!ghCalls(stub).some((c) => c.includes('PATCH')), 'no PATCH in the kit');
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
