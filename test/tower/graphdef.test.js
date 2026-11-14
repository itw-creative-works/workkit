//
// Tests for libs/tower/graphdef.js: the Graph view's mermaid text is pure string
// work, so every question about the picture is asked here, via dynamic `import()`.
//

const path = require('path');
const { pathToFileURL } = require('url');
const { describe, before, test, expect } = require('../lib/harness');

const libs = path.join(__dirname, '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'libs', 'tower');
const load = (name) => import(pathToFileURL(path.join(libs, name)).href);

/** One issue as the sweep normalizes it: `blockedBy` is always a list. */
const issue = (repo, number, extra = {}) => ({
  repo,
  number,
  title: `issue ${number}`,
  status: 'specced',
  blockedBy: [],
  ...extra,
});

/** A blocker reference: the shape `blockedBy` carries. */
const ref = (repo, number) => ({ repo, number });

let boardGraph, nodeId, MAX_TITLE;
before(async () => { ({ boardGraph, nodeId, MAX_TITLE } = await load('graphdef.js')); });

describe('tower/graphdef: who is on the picture', () => {
  test('only the issues in a dependency are drawn', () => {
    const blocked = issue('o/r', 2, { blockedBy: [ref('o/r', 1)] });
    const alone = issue('o/r', 9);
    const def = boardGraph([issue('o/r', 1), blocked, alone], []);
    expect(def.startsWith('flowchart TD'), 'a flowchart, top down').toBeTruthy();
    expect(def.includes(nodeId(ref('o/r', 1))), 'the blocker is a node').toBeTruthy();
    expect(def.includes(nodeId(ref('o/r', 2))), 'so is what it blocks').toBeTruthy();
    expect(!def.includes(nodeId(ref('o/r', 9))), 'an issue waiting on nothing and blocking nothing is not a box').toBeTruthy();
  });

  test('a board with no edges at all composes nothing', () => {
    expect(boardGraph([issue('o/r', 1), issue('o/r', 2)], []), 'the page says so in a line rather than drawing an empty diagram').toBe('');
    expect(boardGraph([], []), 'and an empty board the same way').toBe('');
    expect(boardGraph(null, null), 'a page that has not read anything yet does not throw').toBe('');
  });

  test('the arrow runs blocker → dependent, one per pair however it arrived', () => {
    const def = boardGraph([issue('o/r', 1), issue('o/r', 2, { blockedBy: [ref('o/r', 1), ref('O/R', 1)] })], []);
    const edge = `${nodeId(ref('o/r', 1))} --> ${nodeId(ref('o/r', 2))}`;
    expect(def.includes(edge), 'the blocker unblocks the dependent').toBeTruthy();
    expect(def.split(edge).length - 1, 'and the same pair spelled twice is one arrow').toBe(1);
    expect(!def.includes(`${nodeId(ref('o/r', 2))} --> ${nodeId(ref('o/r', 1))}`), 'never the other way round').toBeTruthy();
  });

  test('the sweep supplies the downstream the board is not showing', () => {
    // The drawn issue blocks something in a repo the scope hides. Without the
    // sweep it looks free; with it, the arrow out of it is the picture.
    const drawn = issue('o/r', 1);
    const elsewhere = issue('other/repo', 7, { blockedBy: [ref('o/r', 1)] });
    const def = boardGraph([drawn], [drawn, elsewhere]);
    expect(def.includes(`${nodeId(ref('o/r', 1))} --> ${nodeId(ref('other/repo', 7))}`), 'the edge is found from the far end').toBeTruthy();
    expect(def.includes('"other/repo#7"'), 'and the far end is a stub carrying its reference alone').toBeTruthy();
    expect(def.split(`--> ${nodeId(ref('other/repo', 7))}`).length - 1, 'an edge both lists is still one arrow').toBe(1);
  });
});

describe('tower/graphdef: what a node says', () => {
  test('a node is its reference, its title and where it stands', () => {
    const def = boardGraph([issue('o/r', 1, { title: 'seed the runner', status: 'blocked' }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    expect(def.includes('"#1 seed the runner - blocked"'), 'the status word rides the label line').toBeTruthy();
    expect(!def.includes('o/r#1'), 'a single-repo board says it the short way, as its cards do').toBeTruthy();
  });

  test('a board showing several repos qualifies every node by repo', () => {
    const def = boardGraph([issue('o/r', 1), issue('other/repo', 2, { blockedBy: [ref('o/r', 1)] })], []);
    expect(def.includes('"o/r#1 issue 1 - specced"'), 'the blocker carries its slug').toBeTruthy();
    expect(def.includes('"other/repo#2 issue 2 - specced"'), 'and so does what it blocks').toBeTruthy();
  });

  test('a long title is cut where a node stops being readable', () => {
    const long = 'a'.repeat(MAX_TITLE + 20);
    const def = boardGraph([issue('o/r', 1, { title: long }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    expect(def.includes(`"#1 ${'a'.repeat(MAX_TITLE)}… - specced`), 'the tail becomes an ellipsis, and what follows the title still follows it').toBeTruthy();
    expect(!def.includes('a'.repeat(MAX_TITLE + 1)), 'and nothing longer survives').toBeTruthy();
  });

  test('an issue with no status word says only what it is', () => {
    const def = boardGraph([issue('o/r', 1, { status: '' }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    expect(def.includes('"#1 issue 1"'), 'no dangling separator where a status would be').toBeTruthy();
  });
});

describe('tower/graphdef: remote text cannot break out of its label', () => {
  test('a hostile title is one label and nothing else', () => {
    const hostile = 'it "quoted" a]["thing" and #35; too';
    const def = boardGraph([issue('o/r', 1, { title: hostile }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    const label = def.split('\n').find((line) => line.includes(nodeId(ref('o/r', 1))) && line.includes('"'));
    expect((label.match(/"/g) || []).length, 'the label opens and closes exactly once').toBe(2);
    expect(!/[[\]{}<>|]/.test(label.slice(label.indexOf('"') + 1, label.lastIndexOf('"'))),
      'no node-shape character is left inside it').toBeTruthy();
    expect(!label.includes('#35;'), 'and no mermaid entity escape either').toBeTruthy();
    expect(label.includes('it \'quoted\''), 'what it said is still readable, in apostrophes').toBeTruthy();
  });

  test('a hostile repo slug is escaped in the label but not in the id', () => {
    const def = boardGraph([issue('o/r', 1), issue('<img src=x>/repo', 2, { blockedBy: [ref('o/r', 1)] })], []);
    expect(!def.includes('<img'), 'the slug is sanitized where it is drawn').toBeTruthy();
    expect(def.includes(nodeId(ref('<img src=x>/repo', 2))), 'and the id is the sanitized-to-safe one either way').toBeTruthy();
    expect(/^[a-z0-9_]+$/.test(nodeId(ref('<img src=x>/repo', 2))), 'which carries word characters only').toBeTruthy();
  });

  test('a title carrying a newline stays on its own statement', () => {
    const def = boardGraph([issue('o/r', 1, { title: 'first\nflowchart TD\nsecond' }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    const lines = def.split('\n');
    expect(lines.filter((line) => line.startsWith('flowchart')).length, 'there is exactly one header statement').toBe(1);
    expect(lines.some((line) => line.includes('"#1 first flowchart TD second - specced"')),
      'the break folded into the one label instead of opening a statement of its own').toBeTruthy();
  });
});

describe('tower/graphdef: the edges that leave the board', () => {
  test('an edge pointing off the board still renders, as a dashed stub', () => {
    const def = boardGraph([issue('o/r', 2, { blockedBy: [ref('o/r', 1), ref('far/away', 5)] })], []);
    expect(def.includes(`${nodeId(ref('o/r', 1))}["#1"]`), 'a blocker the board is not showing is its reference alone').toBeTruthy();
    expect(def.includes(`${nodeId(ref('far/away', 5))}["far/away#5"]`), 'and one in another repo carries its slug').toBeTruthy();
    expect(def.includes('classDef stub stroke-dasharray'), 'the stubs are styled by a class').toBeTruthy();
    expect(!/#[0-9a-f]{3,6}\b/i.test(def), 'and nothing in the definition names a colour').toBeTruthy();
    const applied = def.split('\n').find((line) => line.startsWith('  class '));
    expect(applied.includes(nodeId(ref('o/r', 1))) && applied.includes(nodeId(ref('far/away', 5))), 'both stubs wear it').toBeTruthy();
  });

  test('a board with no stubs carries no class lines at all', () => {
    const def = boardGraph([issue('o/r', 1), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    expect(!def.includes('classDef'), 'nothing to mark, nothing written').toBeTruthy();
  });
});

describe('tower/graphdef: ids', () => {
  test('an id is derived from the reference, never from where it sits', () => {
    const first = boardGraph([issue('o/r', 1), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    const second = boardGraph([issue('o/r', 2, { blockedBy: [ref('o/r', 1)] }), issue('o/r', 1)], []);
    expect(first.includes(nodeId(ref('o/r', 1))) && second.includes(nodeId(ref('o/r', 1))),
      'the same issue is the same node whichever order it arrived in').toBeTruthy();
    expect(nodeId(ref('O/R', 1)), 'and case is not a second issue').toBe(nodeId(ref('o/r', 1)));
    expect(/^n_/.test(nodeId(ref('o/r', 1))), 'an id never starts with a digit').toBeTruthy();
  });
});
