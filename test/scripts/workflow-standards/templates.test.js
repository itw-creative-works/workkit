// Tests for standards.sh: the issue templates, the CI workflow, the kit clone
// step's removal from checks.yml, and the CHANGELOG separator.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { block, listValue } = require('../../lib/workflow-yaml');
const { withCloneStep } = require('../../lib/checks-template');
const { WORKFLOW_DIR, cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');

const cases = async () => {
  group('standards.sh: issue templates');

  await test('creates all four templates with the right auto-labels', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const dir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
    for (const form of ['bug', 'enhancement', 'idea', 'dump']) {
      const body = readFile(path.join(dir, `${form}.md`));
      assert(body, `${form}.md created`);
      // Markdown templates carry their labels in the YAML frontmatter.
      const frontmatter = body.split('---')[1] || '';
      const labelsLine = frontmatter.split('\n').find((line) => line.startsWith('labels:')) || '';
      assert(labelsLine.includes('status:inbox'), `${form}.md applies status:inbox`);
      if (form === 'dump') {
        // type: is required on every issue; a dump of unshaped notes is type:idea by convention.
        assert(labelsLine.includes('type:idea'), 'dump.md applies type:idea');
      } else {
        assert(labelsLine.includes(`type:${form}`), `${form}.md applies type:${form}`);
      }
    }
    cleanup(repo); cleanup(stub.dir);
  });

  // The whole point of markdown templates over YAML forms: the pre-filled body
  // is the spec's anatomy, so a filed issue conforms without triage rewriting it.
  await test('every template pre-fills the issue anatomy', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const dir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
    for (const form of ['bug', 'enhancement', 'idea', 'dump']) {
      const body = readFile(path.join(dir, `${form}.md`));
      const afterFrontmatter = body.split('---').slice(2).join('---');
      assert(afterFrontmatter.includes('## Description'), `${form}.md pre-fills ## Description`);
      assert(afterFrontmatter.includes('## Spec'), `${form}.md pre-fills ## Spec`);
      assert(
        afterFrontmatter.indexOf('## Description') < afterFrontmatter.indexOf('## Spec'),
        `${form}.md orders Description before Spec`,
      );
      assert(
        afterFrontmatter.includes('None needed: small item.'),
        `${form}.md defaults the Spec so an untouched body still conforms`,
      );
    }
    cleanup(repo); cleanup(stub.dir);
  });

  await test('never overwrites a template the repo already customized', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const bug = path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md');
    fs.mkdirSync(path.dirname(bug), { recursive: true });
    fs.writeFileSync(bug, 'name: Custom Bug\n');
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(bug), 'name: Custom Bug\n', 'customization preserved');
    assert(stdout.includes('created 3'), `only the missing three created, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a fully standardized repo reports no creations on re-run', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('4 already present'), `all four seen as present, got: ${stdout}`);
    assert(!stdout.includes('issue forms: created'), 'nothing recreated');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: CI workflow');

  await test('the installed workflow runs on pull requests and on a push to main, a CHANGELOG-only push skipped', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const lines = readFile(path.join(repo, '.github', 'workflows', 'checks.yml')).split(/\r?\n/);
    const on = block(lines, 'on', 0);
    assert(on, 'the workflow has a top-level on:');
    assert(block(on, 'pull_request', 2), `on: lists pull_request:, got: ${on.join('\n')}`);
    const push = block(on, 'push', 2);
    assert(push, `on: lists push:, got: ${on.join('\n')}`);
    const branches = block(push, 'branches', 4);
    const ignored = block(push, 'paths-ignore', 4);
    assert(branches && ignored, `on.push carries branches and paths-ignore, got: ${push.join('\n')}`);
    assertEq(listValue(branches).join(','), 'main', 'the push runs on the default branch');
    assertEq(listValue(ignored).join(','), 'CHANGELOG.md', 'and skips a push touching only the CHANGELOG');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('never overwrites a checks workflow the repo already owns', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: custom\n');
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), 'name: custom\n', 'repo copy preserved');
    assert(stdout.includes('checks: .github/workflows/checks.yml already present'), `reported as a skip, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the kit clone step in checks.yml');

  // Read live in each case, so a reworded template never meets a stale copy.
  const template = () => readFile(path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml'));
  const writeChecks = (repo, body) => {
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };
  // The repo's package.json, on the workkit-core package or not.
  const writePackage = (repo, onCore) => fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({
    name: 'fixture', private: true, scripts: { test: 'workkit test' }, ...(onCore ? { devDependencies: { 'workkit-core': '^1.0.0' } } : {}),
  }, null, 2)}\n`);

  await test('in a repo on workkit-core, the clone step is removed from checks.yml and every other line kept', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    writePackage(repo, true);
    const tpl = template();
    const file = writeChecks(repo, withCloneStep(tpl));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assertEq(readFile(file), tpl, `the template as it ships, the step and its comment gone, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('in a repo on workkit-core, a CRLF checks.yml loses the clone step and keeps its CRLF endings', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    writePackage(repo, true);
    const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
    const tpl = template();
    const file = writeChecks(repo, crlf(withCloneStep(tpl)));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assertEq(readFile(file), crlf(tpl), `the template in CRLF, the step gone, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // A step the repo wrote itself may clone the kit with the same line; only the
  // step under the retired step's name is the kit's.
  await test('in a repo on workkit-core, a step of the repo\'s own that clones the kit survives', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    writePackage(repo, true);
    const tpl = template();
    const own = [
      '      - name: Fetch the kit for the hooks suites',
      '        run: git clone --depth 1 https://github.com/itw-creative-works/workkit "$RUNNER_TEMP/workkit"',
    ];
    const withOwn = (text) => {
      const lines = text.split('\n');
      const at = lines.indexOf('      - name: Test');
      assert(at > 0, 'the template carries the Test step');
      return [...lines.slice(0, at), ...own, ...lines.slice(at)].join('\n');
    };
    const file = writeChecks(repo, withCloneStep(withOwn(tpl)));
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assertEq(readFile(file), withOwn(tpl), `the kit step gone, the repo's own kept, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // The two shapes a repo not yet on the package can carry: an older copy with
  // the step, and the template as it ships now, without it.
  await test('in a repo without workkit-core, checks.yml is left byte for byte, the clone step or none', () => {
    const tpl = template();
    for (const [shape, body] of [['with the clone step', withCloneStep(tpl)], ['without it', tpl]]) {
      const repo = makeRepo();
      const stub = makeGhStub();
      writePackage(repo, false);
      const file = writeChecks(repo, body);
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(readFile(file), body, `${shape}: as found, got: ${output}`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  await test('a repo with no checks.yml gets the template whole', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(path.join(repo, '.github', 'workflows', 'checks.yml')), template(), `byte for byte, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the CHANGELOG separator');

  await test('an em dash CHANGELOG is converted to spaced hyphens once (#248)', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, 'CHANGELOG.md');
    fs.writeFileSync(file,
      '# Changelog\n\n## [Unreleased]\n\n- [#4](../../issues/4) \u2014 One thing \u2014 with a dash inside,\n  wrapped \u2014\n  \u2014 and twice at a boundary.\n');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), '# Changelog\n\n## [Unreleased]\n\n- [#4](../../issues/4) - One thing - with a dash inside,\n  wrapped -\n  - and twice at a boundary.\n', 'every em dash became a hyphen, and no newline was swallowed');
    assert(output.includes('changelog separator: converted 4 em dashes'), `reported the conversion, got: ${output}`);
    const again = runScript(repo, { pathPrefix: stub.binDir }).output;
    assert(!again.includes('changelog separator'), `a clean file is silent, got: ${again}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
