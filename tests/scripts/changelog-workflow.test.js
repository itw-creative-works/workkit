//
// Tests for the reusable CHANGELOG workflow (.github/workflows/changelog.yml):
// the one CI home of the entry-format check, which every participating repo's
// checks.yml calls through the template's `uses:` line instead of carrying a
// copy of the linter. The shape is read off the lines; the kit has no YAML
// dependency and the questions here are all line-shaped.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const ROOT = path.join(__dirname, '..', '..');
const REUSABLE_REL = '.github/workflows/changelog.yml';
const REUSABLE = path.join(ROOT, REUSABLE_REL);
const TEMPLATE = path.join(ROOT, 'workflow', 'templates', 'github-workflows', 'checks.yml');
const OWN_CHECKS = path.join(ROOT, '.github', 'workflows', 'checks.yml');

const read = (file) => fs.readFileSync(file, 'utf8');

// The lines of one job, from `  <name>:` to the next top-level key or job.
const jobBlock = (text, name) => {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^ {0,2}[A-Za-z_-]+:/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n').trimEnd();
};

// The one `uses:` line a caller's changelog job is made of.
const USES_RE = /^ {4}uses: ([\w.-]+\/[\w.-]+)\/(\.github\/workflows\/[\w.-]+\.yml)@main$/;

const run = async () => {
  group('changelog.yml: the reusable workflow');

  await test('it is callable and only callable: on is workflow_call alone', () => {
    const text = read(REUSABLE);
    assert(!text.includes('\t'), 'no tab indentation, which YAML rejects');
    const lines = text.split('\n');
    const on = lines.indexOf('on:');
    assert(on !== -1, `a top-level on: key, got:\n${text}`);
    const triggers = [];
    for (let i = on + 1; i < lines.length && !/^[A-Za-z_-]+:/.test(lines[i]); i++) {
      if (/^ {2}[A-Za-z_-]+:/.test(lines[i])) triggers.push(lines[i].trim());
    }
    assertEq(triggers.join(','), 'workflow_call:', 'the one trigger is a call from another workflow');
  });

  await test('it checks out the kit into a subfolder and lints the caller from there', () => {
    const text = read(REUSABLE);
    const repo = text.match(/^ +repository: (\S+)$/m);
    const sub = text.match(/^ +path: (\S+)$/m);
    assert(repo && sub, `a second checkout carries repository: and path:, got:\n${text}`);
    assert(text.includes(`node ${sub[1]}/workflow/changelog.js CHANGELOG.md --unreleased-only`),
      `the linter runs from the kit's checkout over the caller's unreleased section, got:\n${text}`);
    assert(fs.existsSync(path.join(ROOT, 'workflow', 'changelog.js')), 'at a path the kit really has');
    assert(text.includes('no CHANGELOG.md, nothing to check'), 'a caller with no CHANGELOG passes with a message');
    assert(/uses: actions\/checkout@v5/.test(text) && /uses: actions\/setup-node@v5/.test(text),
      'actions pinned the way the checks template pins them');
  });

  group('checks.yml: callers use the published path');

  await test('the template\'s changelog job is the one uses: line, aimed at this repo\'s workflow', () => {
    const block = jobBlock(read(TEMPLATE), 'changelog');
    assert(block, 'the template defines a changelog job');
    const lines = block.split('\n');
    assertEq(lines.length, 2, `the job is its name and one uses: line, got:\n${block}`);
    const m = lines[1].match(USES_RE);
    assert(m, `a uses: line of owner/repo/path@main, got: ${lines[1]}`);
    assertEq(m[2], REUSABLE_REL, 'the path is the workflow this repo publishes');
    assert(fs.existsSync(path.join(ROOT, m[2])), 'and that file exists');
    const repo = read(REUSABLE).match(/^ +repository: (\S+)$/m);
    assertEq(m[1], repo && repo[1], 'the repo it calls is the repo the workflow checks the linter out of');
    assert(!read(TEMPLATE).includes('changelog-lint'), 'the template names no vendored copy');
  });

  await test('this repo\'s own checks.yml calls the same workflow the same way', () => {
    assertEq(jobBlock(read(OWN_CHECKS), 'changelog'), jobBlock(read(TEMPLATE), 'changelog'),
      'the kit runs the check its callers run');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
