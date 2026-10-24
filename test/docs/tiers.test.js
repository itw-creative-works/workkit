// Every doc that names the central address spells it the same way.
const path = require('path');
const fs = require('fs');
const { group, test, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const ADDRESS = 'https://itw-creative-works.github.io/workkit/';
const DOCS = ['README.md', 'docs/setup.md', 'tower/README.md'];

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// Every mention of the host and path, any case, with what it is written as:
// the scheme in front of it through the slash after it.
const mentions = (text) => [...text.matchAll(/itw-creative-works\.github\.io\/workkit/gi)]
  .map((m) => text.slice(Math.max(0, m.index - 'https://'.length), m.index + m[0].length + 1));

const run = async () => {
  group('docs: the central address');

  await test(`every mention is spelled ${ADDRESS}`, () => {
    const odd = DOCS.flatMap((rel) => mentions(read(rel)).filter((m) => m !== ADDRESS).map((m) => `${rel}: ${m}`));
    assertEq(odd.join('; '), '', 'mentions spelled another way');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
