//
// Tests for the tower dashboard's dependency-graph composer (issue #103).
//
// `libs/tower/graphdef.js` is the whole reason the Graph view is testable at
// all: the graph module draws into a real DOM and node has none, but composing
// the mermaid text is pure string work, so every question worth asking about
// the picture — who is a node, which way the arrow runs, what a hostile title
// becomes, what happens to an edge pointing off the board — is asked here.
//
// An ES module written for a browser, so it is pulled in with a dynamic
// `import()`, the way app.test.js reaches the other pure libs. It imports only
// `format.js`, which imports nothing at all, so nothing bundler-specific is in
// reach of the load.
//

const path = require('path');
const { pathToFileURL } = require('url');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const libs = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'libs', 'tower');
const load = (name) => import(pathToFileURL(path.join(libs, name)).href);

/** One issue as the sweep normalizes it — `blockedBy` is always a list (#103). */
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

const run = async () => {
  const { boardGraph, nodeId, MAX_TITLE } = await load('graphdef.js');

  group('tower/graphdef: who is on the picture');

  await test('only the issues in a dependency are drawn', () => {
    const blocked = issue('o/r', 2, { blockedBy: [ref('o/r', 1)] });
    const alone = issue('o/r', 9);
    const def = boardGraph([issue('o/r', 1), blocked, alone], []);
    assert(def.startsWith('flowchart TD'), 'a flowchart, top down');
    assert(def.includes(nodeId(ref('o/r', 1))), 'the blocker is a node');
    assert(def.includes(nodeId(ref('o/r', 2))), 'so is what it blocks');
    assert(!def.includes(nodeId(ref('o/r', 9))), 'an issue waiting on nothing and blocking nothing is not a box');
  });

  await test('a board with no edges at all composes nothing', () => {
    assertEq(boardGraph([issue('o/r', 1), issue('o/r', 2)], []), '',
      'the page says so in a line rather than drawing an empty diagram');
    assertEq(boardGraph([], []), '', 'and an empty board the same way');
    assertEq(boardGraph(null, null), '', 'a page that has not read anything yet does not throw');
  });

  await test('the arrow runs blocker → dependent, one per pair however it arrived', () => {
    const def = boardGraph([issue('o/r', 1), issue('o/r', 2, { blockedBy: [ref('o/r', 1), ref('O/R', 1)] })], []);
    const edge = `${nodeId(ref('o/r', 1))} --> ${nodeId(ref('o/r', 2))}`;
    assert(def.includes(edge), 'the blocker unblocks the dependent');
    assertEq(def.split(edge).length - 1, 1, 'and the same pair spelled twice is one arrow');
    assert(!def.includes(`${nodeId(ref('o/r', 2))} --> ${nodeId(ref('o/r', 1))}`), 'never the other way round');
  });

  await test('the sweep supplies the downstream the board is not showing', () => {
    // The drawn issue blocks something in a repo the scope hides. Without the
    // sweep it looks free; with it, the arrow out of it is the picture.
    const drawn = issue('o/r', 1);
    const elsewhere = issue('other/repo', 7, { blockedBy: [ref('o/r', 1)] });
    const def = boardGraph([drawn], [drawn, elsewhere]);
    assert(def.includes(`${nodeId(ref('o/r', 1))} --> ${nodeId(ref('other/repo', 7))}`), 'the edge is found from the far end');
    assert(def.includes('"other/repo#7"'), 'and the far end is a stub carrying its reference alone');
    assertEq(def.split(`--> ${nodeId(ref('other/repo', 7))}`).length - 1, 1,
      'an edge both lists is still one arrow');
  });

  group('tower/graphdef: what a node says');

  await test('a node is its reference, its title and where it stands', () => {
    const def = boardGraph([issue('o/r', 1, { title: 'seed the runner', status: 'blocked' }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    assert(def.includes('"#1 seed the runner — blocked"'), 'the status word rides the label line');
    assert(!def.includes('o/r#1'), 'a single-repo board says it the short way, as its cards do');
  });

  await test('a board showing several repos qualifies every node by repo', () => {
    const def = boardGraph([issue('o/r', 1), issue('other/repo', 2, { blockedBy: [ref('o/r', 1)] })], []);
    assert(def.includes('"o/r#1 issue 1 — specced"'), 'the blocker carries its slug');
    assert(def.includes('"other/repo#2 issue 2 — specced"'), 'and so does what it blocks');
  });

  await test('a long title is cut where a node stops being readable', () => {
    const long = 'a'.repeat(MAX_TITLE + 20);
    const def = boardGraph([issue('o/r', 1, { title: long }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    assert(def.includes(`"#1 ${'a'.repeat(MAX_TITLE)}… — specced`), 'the tail becomes an ellipsis, and what follows the title still follows it');
    assert(!def.includes('a'.repeat(MAX_TITLE + 1)), 'and nothing longer survives');
  });

  await test('an issue with no status word says only what it is', () => {
    const def = boardGraph([issue('o/r', 1, { status: '' }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    assert(def.includes('"#1 issue 1"'), 'no dangling separator where a status would be');
  });

  group('tower/graphdef: remote text cannot break out of its label');

  await test('a hostile title is one label and nothing else', () => {
    const hostile = 'it "quoted" a]["thing" and #35; too';
    const def = boardGraph([issue('o/r', 1, { title: hostile }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    const label = def.split('\n').find((line) => line.includes(nodeId(ref('o/r', 1))) && line.includes('"'));
    assertEq((label.match(/"/g) || []).length, 2, 'the label opens and closes exactly once');
    assert(!/[[\]{}<>|]/.test(label.slice(label.indexOf('"') + 1, label.lastIndexOf('"'))),
      'no node-shape character is left inside it');
    assert(!label.includes('#35;'), 'and no mermaid entity escape either');
    assert(label.includes('it \'quoted\''), 'what it said is still readable, in apostrophes');
  });

  await test('a hostile repo slug is escaped in the label but not in the id', () => {
    const def = boardGraph([issue('o/r', 1), issue('<img src=x>/repo', 2, { blockedBy: [ref('o/r', 1)] })], []);
    assert(!def.includes('<img'), 'the slug is sanitized where it is drawn');
    assert(def.includes(nodeId(ref('<img src=x>/repo', 2))), 'and the id is the sanitized-to-safe one either way');
    assert(/^[a-z0-9_]+$/.test(nodeId(ref('<img src=x>/repo', 2))), 'which carries word characters only');
  });

  await test('a title carrying a newline stays on its own statement', () => {
    const def = boardGraph([issue('o/r', 1, { title: 'first\nflowchart TD\nsecond' }), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    const lines = def.split('\n');
    assertEq(lines.filter((line) => line.startsWith('flowchart')).length, 1, 'there is exactly one header statement');
    assert(lines.some((line) => line.includes('"#1 first flowchart TD second — specced"')),
      'the break folded into the one label instead of opening a statement of its own');
  });

  group('tower/graphdef: the edges that leave the board');

  await test('an edge pointing off the board still renders, as a dashed stub', () => {
    const def = boardGraph([issue('o/r', 2, { blockedBy: [ref('o/r', 1), ref('far/away', 5)] })], []);
    assert(def.includes(`${nodeId(ref('o/r', 1))}["#1"]`), 'a blocker the board is not showing is its reference alone');
    assert(def.includes(`${nodeId(ref('far/away', 5))}["far/away#5"]`), 'and one in another repo carries its slug');
    assert(def.includes('classDef stub stroke-dasharray'), 'the stubs are styled by a class');
    assert(!/#[0-9a-f]{3,6}\b/i.test(def), 'and nothing in the definition names a colour');
    const applied = def.split('\n').find((line) => line.startsWith('  class '));
    assert(applied.includes(nodeId(ref('o/r', 1))) && applied.includes(nodeId(ref('far/away', 5))), 'both stubs wear it');
  });

  await test('a board with no stubs carries no class lines at all', () => {
    const def = boardGraph([issue('o/r', 1), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    assert(!def.includes('classDef'), 'nothing to mark, nothing written');
  });

  group('tower/graphdef: ids');

  await test('an id is derived from the reference, never from where it sits', () => {
    const first = boardGraph([issue('o/r', 1), issue('o/r', 2, { blockedBy: [ref('o/r', 1)] })], []);
    const second = boardGraph([issue('o/r', 2, { blockedBy: [ref('o/r', 1)] }), issue('o/r', 1)], []);
    assert(first.includes(nodeId(ref('o/r', 1))) && second.includes(nodeId(ref('o/r', 1))),
      'the same issue is the same node whichever order it arrived in');
    assertEq(nodeId(ref('O/R', 1)), nodeId(ref('o/r', 1)), 'and case is not a second issue');
    assert(/^n_/.test(nodeId(ref('o/r', 1))), 'an id never starts with a digit');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
