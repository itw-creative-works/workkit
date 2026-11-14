// Tests for standards.sh: the issue templates and the CHANGELOG separator; the
// checks.yml caller is ./checks-caller.test.js.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const { cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');

describe('standards.sh: issue templates', () => {
  test('creates all four templates with the right auto-labels', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const dir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
    for (const form of ['bug', 'enhancement', 'idea', 'dump']) {
      const body = readFile(path.join(dir, `${form}.md`));
      expect(body, `${form}.md created`).toBeTruthy();
      // Markdown templates carry their labels in the YAML frontmatter.
      const frontmatter = body.split('---')[1] || '';
      const labelsLine = frontmatter.split('\n').find((line) => line.startsWith('labels:')) || '';
      expect(labelsLine.includes('status:inbox'), `${form}.md applies status:inbox`).toBeTruthy();
      if (form === 'dump') {
        // type: is required on every issue; a dump of unshaped notes is type:idea by convention.
        expect(labelsLine.includes('type:idea'), 'dump.md applies type:idea').toBeTruthy();
      } else {
        expect(labelsLine.includes(`type:${form}`), `${form}.md applies type:${form}`).toBeTruthy();
      }
    }
    cleanup(repo); cleanup(stub.dir);
  });

  // The whole point of markdown templates over YAML forms: the pre-filled body
  // is the spec's anatomy, so a filed issue conforms without triage rewriting it.
  test('every template pre-fills the issue anatomy', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const dir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
    for (const form of ['bug', 'enhancement', 'idea', 'dump']) {
      const body = readFile(path.join(dir, `${form}.md`));
      const afterFrontmatter = body.split('---').slice(2).join('---');
      expect(afterFrontmatter.includes('## Description'), `${form}.md pre-fills ## Description`).toBeTruthy();
      expect(afterFrontmatter.includes('## Spec'), `${form}.md pre-fills ## Spec`).toBeTruthy();
      expect(
        afterFrontmatter.indexOf('## Description') < afterFrontmatter.indexOf('## Spec'),
        `${form}.md orders Description before Spec`,
      ).toBeTruthy();
      expect(
        afterFrontmatter.includes('None needed: small item.'),
        `${form}.md defaults the Spec so an untouched body still conforms`,
      ).toBeTruthy();
    }
    cleanup(repo); cleanup(stub.dir);
  });

  test('never overwrites a template the repo already customized', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const bug = path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md');
    fs.mkdirSync(path.dirname(bug), { recursive: true });
    fs.writeFileSync(bug, 'name: Custom Bug\n');
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    expect(readFile(bug), 'customization preserved').toBe('name: Custom Bug\n');
    expect(stdout.includes('created 3'), `only the missing three created, got: ${stdout}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a fully standardized repo reports no creations on re-run', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    expect(stdout.includes('4 already present'), `all four seen as present, got: ${stdout}`).toBeTruthy();
    expect(!stdout.includes('issue forms: created'), 'nothing recreated').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});

describe('standards.sh: the CHANGELOG separator', () => {
  test('an em dash CHANGELOG is converted to spaced hyphens once (#248)', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, 'CHANGELOG.md');
    fs.writeFileSync(file,
      '# Changelog\n\n## [Unreleased]\n\n- [#4](../../issues/4) \u2014 One thing \u2014 with a dash inside,\n  wrapped \u2014\n  \u2014 and twice at a boundary.\n');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    expect(readFile(file), 'every em dash became a hyphen, and no newline was swallowed').toBe('# Changelog\n\n## [Unreleased]\n\n- [#4](../../issues/4) - One thing - with a dash inside,\n  wrapped -\n  - and twice at a boundary.\n');
    expect(output.includes('changelog separator: converted 4 em dashes'), `reported the conversion, got: ${output}`).toBeTruthy();
    const again = runScript(repo, { pathPrefix: stub.binDir }).output;
    expect(!again.includes('changelog separator'), `a clean file is silent, got: ${again}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});
