// Tests for the gh journal mark's pure helpers in hooks/mods/markers.js:
// journalSizes, the folder's sized listing, journalMarkText and journalMarks,
// the mark's text and its read back, and journalsGrown, the pick of the
// journals a Bash call's Post hook reads. The mark written and read through
// the hooks module: test/mods/post-tool-use-bash.test.ts.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const markers = () => mods('markers');
const same = (actual, expected, label) => assertEq(JSON.stringify(actual), JSON.stringify(expected), label);

const HOME = '/w/home/.workkit';
const A = '/w/home/.workkit/markers/claude-gh-journal/aaa';
const B = '/w/home/.workkit/markers/claude-gh-journal/bbb';
const C = '/w/home/.workkit/markers/claude-gh-journal/ccc';
const D = '/w/home/.workkit/markers/claude-gh-journal/ddd';
const SIZES = { [A]: 62, [B]: 0 };

const cases = async () => {
  group('markers: the gh journal mark');

  await test('case 9: two sized journals make a path line and a length line each, in the order given, and read back as the same pairs', () => {
    const text = markers().journalMarkText([{ journal: A, bytes: 62 }, { journal: B, bytes: 0 }]);
    assertEq(text, `${A}\n62\n${B}\n0`, 'the mark text');
    same(markers().journalMarks(text), [{ journal: A, bytes: 62 }, { journal: B, bytes: 0 }], 'the mark read back');
  });

  await test('case 9: no journals make the empty mark, read back as none', () => {
    const text = markers().journalMarkText([]);
    assertEq(text, '', 'the mark text');
    same(markers().journalMarks(text), [], 'the mark read back');
  });

  await test('case 9: journalSizes lists the journal folder and answers each journal\'s full path and length, in name order', async () => {
    const listed = [];
    const list = async (dir) => {
      listed.push(dir);
      return ['bbb', 'aaa'];
    };
    const sized = await markers().journalSizes(list, async (journal) => SIZES[journal], HOME);
    same(listed, [`${HOME}/markers/claude-gh-journal`], 'the folder listed');
    same(sized, [{ journal: A, bytes: 62 }, { journal: B, bytes: 0 }], 'aaa before bbb, each with its length');
  });

  await test('case 10: an empty path line is skipped with its length line', () => {
    same(markers().journalMarks(`\n5\n${B}\n9`), [{ journal: B, bytes: 9 }], 'the one named journal');
  });

  group('markers: journalsGrown');

  const MARKS = [{ journal: A, bytes: 10 }, { journal: B, bytes: 20 }, { journal: C, bytes: 30 }];

  await test('case 11: a grown journal answers its marked length, an unmarked one and one shorter than its mark 0, in the order after the call', () => {
    const now = [{ journal: D, bytes: 7 }, { journal: A, bytes: 15 }, { journal: C, bytes: 12 }];
    same(markers().journalsGrown(MARKS, now), [{ journal: D, bytes: 0 }, { journal: A, bytes: 10 }, { journal: C, bytes: 0 }], 'D from its start, A past 10, C from its start');
  });

  await test('case 11: a journal at its marked length is left out', () => {
    const now = [{ journal: B, bytes: 20 }];
    same(markers().journalsGrown(MARKS, now), [], 'B at its length');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
