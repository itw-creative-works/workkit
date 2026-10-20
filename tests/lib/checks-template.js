// The opening sentence of the kit's checks.yml template, as the changelog-job
// suites read it, and the three-line rewrap both prove the heal against.

const { assert } = require('./harness');

// A template's opening sentence: its leading `#` lines up to and including the
// first that ends in a period.
const openingLines = (text) => {
  const lines = text.split('\n');
  const end = lines.findIndex((l) => !l.startsWith('#') || l.endsWith('.'));
  assert(end >= 0 && lines[end].startsWith('#'), 'the template opens with a # sentence ending in a period');
  return `${lines.slice(0, end + 1).join('\n')}\n`;
};

const TOP_THREE = '# Checks (workflow spec): the test gate that runs on every\n'
  + '# pull request and every push to the\n# default branch.\n';

module.exports = { openingLines, TOP_THREE };
