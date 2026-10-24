// Tests for standards.sh: the issue templates, the CI workflow, the kit clone
// step in checks.yml, and the CHANGELOG separator.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { block, listValue, isContent } = require('../../lib/workflow-yaml');
const { splitCloneStep, withoutCloneStep } = require('../../lib/checks-template');
const { WORKFLOW_DIR, cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');

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
  const NO_TEST = 'checks.yml: no Test step as the template names it; the kit clone step was not added';
  const writeChecks = (repo, body) => {
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };

  await test('an older checks.yml gains the template\'s clone step right before Test, every other line kept', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const tpl = template();
    const file = writeChecks(repo, withoutCloneStep(tpl));
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const [head, step, tail] = splitCloneStep(tpl);
    const healed = readFile(file).split('\n');
    assertEq(healed.slice(0, head.length).join('\n'), head.join('\n'), `every line above the step is kept, got: ${output}`);
    assertEq(healed.slice(-tail.length).join('\n'), tail.join('\n'), 'and every line from the Test step on');
    assertEq(healed.slice(head.length, -tail.length).filter(isContent).join('\n'), step.filter(isContent).join('\n'),
      'the template\'s clone step in between, so the steps run in the template\'s order');
    assert(output.includes('checks.yml: kit clone step added'), `reported, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a CRLF older checks.yml gains the clone step in its own line endings, every other line kept', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const tpl = template();
    const file = writeChecks(repo, withoutCloneStep(tpl).split('\n').join('\r\n'));
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const [head, step, tail] = splitCloneStep(tpl);
    const raw = readFile(file);
    const bare = raw.split('\n').slice(0, -1).filter((line) => !line.endsWith('\r'));
    assertEq(bare.length, 0, `every line keeps the file's CRLF ending, got LF-only: ${JSON.stringify(bare)}`);
    const healed = raw.split('\r\n');
    assertEq(healed.slice(0, head.length).join('\n'), head.join('\n'), `every line above the step is kept, got: ${output}`);
    assertEq(healed.slice(-tail.length).join('\n'), tail.join('\n'), 'and every line from the Test step on');
    assertEq(healed.slice(head.length, -tail.length).filter(isContent).join('\n'), step.filter(isContent).join('\n'),
      'the template\'s clone step in between');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the clone step is added once: a second heal changes nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const tpl = template();
    const older = withoutCloneStep(tpl);
    const file = writeChecks(repo, older);
    runScript(repo, { pathPrefix: stub.binDir });
    const once = readFile(file);
    assert(once !== older, 'the first heal added the step');
    runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), once, 'idempotent');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a checks.yml already carrying the clone step, anywhere in its steps, is left byte for byte', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const tpl = template();
    const [head, step, tail] = splitCloneStep(tpl);
    const at = head.indexOf('      - name: Install dependencies');
    assert(at !== -1, 'the template installs dependencies in a named step');
    const owned = [...head.slice(0, at), ...step, ...head.slice(at), ...tail].join('\n');
    const file = writeChecks(repo, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), owned, `the repo's own placement stands, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a checks.yml whose Test step was renamed is left as found, with one warning', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const tpl = template();
    const older = withoutCloneStep(tpl);
    const renamed = older.replace('      - name: Test\n', '      - name: Unit tests\n');
    assert(renamed !== older, 'the older copy carries the template\'s Test step to rename');
    const file = writeChecks(repo, renamed);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), renamed, `no step is added, got: ${output}`);
    assertEq(output.split(NO_TEST).length - 1, 1, `the warning, once, got: ${output}`);
    assertEq(code, 0, `a warning, never a failed heal, got: ${output}`);
    assert(!output.includes('not fully standardized'), `and the repo is not flagged, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
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

module.exports = run;

if (require.main === module) selfRun(run);
