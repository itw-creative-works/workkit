// The three ways to see a board, as the docs tell them: the central copy at
// its one address, the local tower, and your own published copy. Every doc
// that names the central address spells it the same way.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const ADDRESS = 'https://itw-creative-works.github.io/workkit/';
const DOCS = ['README.md', 'docs/setup.md', 'tower/README.md'];
const TIERED = ['README.md', 'docs/setup.md'];

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// Every mention of the host and path, any case, with what it is written as:
// the scheme in front of it through the slash after it.
const mentions = (text) => [...text.matchAll(/itw-creative-works\.github\.io\/workkit/gi)]
  .map((m) => text.slice(Math.max(0, m.index - 'https://'.length), m.index + m[0].length + 1));

// The text under each heading, up to the next heading of any level.
const sections = (text) => text.split(/^#{1,6} .*$/m);

const run = async () => {
  group('docs: the central address');

  await test('README.md, docs/setup.md and tower/README.md each name the central address', () => {
    const silent = DOCS.filter((rel) => mentions(read(rel)).length === 0);
    assertEq(silent.join(', '), '', 'docs that never name it');
  });

  await test(`every mention is spelled ${ADDRESS}`, () => {
    const odd = DOCS.flatMap((rel) => mentions(read(rel)).filter((m) => m !== ADDRESS).map((m) => `${rel}: ${m}`));
    assertEq(odd.join('; '), '', 'mentions spelled another way');
  });

  group('docs: the three tiers');

  for (const rel of TIERED) {
    await test(`${rel} names the central address, \`workkit tower\` and \`workkit publish\` in one section`, () => {
      const together = sections(read(rel))
        .some((s) => s.includes(ADDRESS) && s.includes('workkit tower') && s.includes('workkit publish'));
      assert(together, `${rel} has no section naming all three tiers`);
    });
  }

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
