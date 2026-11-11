// This repo's markdown held to the shape docs:board-guard enforces on a write:
// every tracked *.md but the hook's exempt names and folders reads through docShape with
// no prose line and no dense line.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, run, selfRun, summary } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const REPO = path.join(__dirname, '..', '..');

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const tracked = ({ SHAPE_EXEMPT, SHAPE_EXEMPT_DIRS }) => {
  const r = run('git', ['ls-files', '-z', '--', '*.md'], { cwd: REPO });
  assertEq(r.status, 0, `git ls-files failed: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean)
    .filter((rel) => !SHAPE_EXEMPT.includes(path.posix.basename(rel)))
    .filter((rel) => !SHAPE_EXEMPT_DIRS.includes(path.posix.basename(path.posix.dirname(rel))));
};

// One worklist line: a half's count, then its first three line numbers.
const half = (name, nums) => (nums.length ? `${name} ${nums.length} (lines ${nums.slice(0, 3).join(', ')})` : `${name} 0`);

const cases = async () => {
  group('docs: the markdown shape');

  await test('case 11: every tracked markdown file but CHANGELOG.md, LICENSE.md and the ISSUE_TEMPLATE and issue-forms folders has no prose and no dense line', () => {
    const guard = mods('board-guard');
    const { docShape } = guard;
    const files = tracked(guard);
    assert(files.length > 0, 'git ls-files listed no markdown');
    const failing = files
      .map((rel) => ({ rel, ...docShape(read(rel)) }))
      .filter((s) => s.prose.length || s.dense.length)
      .map((s) => `${s.rel}: ${half('prose', s.prose)}, ${half('dense', s.dense)}`);
    assert(failing.length === 0, `${failing.length} of ${files.length} files break the markdown shape:\n${failing.join('\n')}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
