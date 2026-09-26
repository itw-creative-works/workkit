//
// Tests for standards.sh: branch protection.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { stubTool } = require('../../lib/platform');
const { cleanup, makeRepo, makeGhStub, readFile, ghCalls, runScript } = require('./helpers');

const run = async () => {
  group('standards.sh: branch protection');

  await test('asks GitHub to require the test check when none is set', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'absent' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main now requires the test check'), `applied, got: ${output}`);
    const put = ghCalls(stub).find((c) => c.includes('api') && c.includes('PUT'));
    assert(put, 'a PUT went to the protection endpoint');
    assert(put.join(' ').includes('repos/stub/repo/branches/main/protection'), `right endpoint, got: ${put.join(' ')}`);
    const body = JSON.parse(readFile(path.join(stub.dir, 'put-body.json')));
    assertEq(JSON.stringify(body.required_status_checks.contexts), '["test"]',
      'requires exactly the test check: the job id checks.yml defines');
    assertEq(body.enforce_admins, false, 'admins stay exempt, so the direct path keeps working');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a GET that fails for any reason but 404 writes nothing', () => {
    // "protected but unreadable" (rate limit, outage) must not be answered by
    // PUTting the minimal payload over whatever configuration exists.
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'absent' });
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
    const stub = makeGhStub({ repoView: true, protection: 'present' });
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(output.includes('protection: main already protected'), `reported as a skip, got: ${output}`);
    assert(!ghCalls(stub).some((c) => c.includes('PUT')), 'no PUT: never overwrites a configured protection');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a rejected protection is a quiet skip, never a failed heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoView: true, protection: 'denied' });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0: advisory by design');
    assert(output.includes('protection: not applied'), `says so quietly, got: ${output}`);
    assert(!output.includes('not fully standardized'), 'needs_attention untouched');
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
