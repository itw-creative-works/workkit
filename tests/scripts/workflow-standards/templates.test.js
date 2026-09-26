//
// Tests for standards.sh: the issue templates, the CI workflow, and the
// CHANGELOG separator.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');

const run = async () => {
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
  // IS the spec's anatomy, so a filed issue conforms without triage rewriting it.
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

  await test('installs the required-checks workflow on heal', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const body = readFile(path.join(repo, '.github', 'workflows', 'checks.yml'));
    assert(body, 'checks.yml created');
    assert(body.includes('pull_request'), 'runs on pull requests');
    assert(body.includes('npm test'), 'runs the test suite');
    assert(stdout.includes('checks: created'), `reported the install, got: ${stdout}`);
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

module.exports = run;

if (require.main === module) selfRun(run);
