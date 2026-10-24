// The kit's checks.yml template as the heal suites read it: its opening
// sentence, the three-line rewrap both changelog-job suites prove the heal
// against, and the template with its kit clone step cut out.

const { assert } = require('./harness');
const { childrenOf, isComment } = require('./workflow-yaml');

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

// The clone line the step is known by.
const CLONE_LINE = 'git clone --depth 1 https://github.com/itw-creative-works/workkit';

// The template's lines in three parts: before the kit clone step, the step
// itself (the comment lines above it included), and after it.
const splitCloneStep = (text) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l, i) => /^ *- /.test(l)
    && childrenOf(lines, i).some((c) => c.includes(CLONE_LINE)));
  assert(at > 0, 'the template carries a step holding the kit clone line');
  let from = at;
  while (isComment(lines[from - 1])) from -= 1;
  const to = at + 1 + childrenOf(lines, at).length;
  return [lines.slice(0, from), lines.slice(from, to), lines.slice(to)];
};

// The template as an older copy carries it: the kit clone step cut out whole.
const withoutCloneStep = (text) => {
  const [head, , tail] = splitCloneStep(text);
  return [...head, ...tail].join('\n');
};

module.exports = { openingLines, TOP_THREE, splitCloneStep, withoutCloneStep };
