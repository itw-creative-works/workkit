//
// Tests for the tower dashboard's Board page: the List | Graph toggle.
// The header this suite's notes point at (why a page module is out of reach
// under Node) is the one atop ./helpers.js, which holds the shared prologue.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');

const run = async () => {
  group('tower/app: board - the List | Graph toggle');

  // The page imports the framework and the graph module, so it is out of reach
  // of these suites (see the header) - what can be pinned is the source of the
  // decisions, the way every other page-level claim here is. The picture ITSELF
  // is pure and has a suite of its own: tests/tower/graphdef.test.js.

  await test('which view is on screen lives in the URL, and `list` is written as nothing at all', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/const VIEWS = \['list', 'graph'\]/.test(source), 'two views, named');
    assert(/searchParams\.get\('view'\)[\s\S]{0,120}VIEWS\.includes\(value\) \? value : 'list'/.test(source),
      'the URL is read back and anything outside the two reads as the default, never as an empty page');
    assert(/url\.searchParams\.set\('view', view\)[\s\S]{0,80}url\.searchParams\.delete\('view'\)/.test(source),
      'the round trip writes the graph and takes the default off rather than leaving ?view=list behind');
    assert(/history\.replaceState\(null, '', url\)/.test(source), 'through replaceState, like the filters beside it');
    assert(/const view = readView\(\);/.test(source), 'and every paint re-reads it, so the 60-second repaint cannot revert the view');
  });

  await test('the board is one strip in two groups - the pipeline flows, the pocket waits (#196)', () => {
    const fs = require('fs');
    const src = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets');
    const source = fs.readFileSync(path.join(src, 'js', 'pages', 'board.js'), 'utf8');
    // Which lanes are which is the vocabulary's flag, never a list here: a
    // second list of statuses on this page is the drift the flag exists to stop.
    assert(/STATUSES\.filter\(\(status\) => !status\.pocket\)/.test(source), 'the pipeline group is the lanes that are stages');
    assert(/STATUSES\.filter\(\(status\) => status\.pocket\)/.test(source), 'and the pocket group is the lanes that are not');
    assert(!/'blocked', 'backlog'|"blocked", "backlog"/.test(source), 'the page names neither of them itself');
    // ONE grid holds all of them, sized by how many the vocabulary has, so every
    // lane on the board is one width - two strips of their own were two widths.
    assertEq((source.match(/class="omega-tower-board"/g) || []).length, 1, 'one strip holds every lane');
    assert(/style="--pipeline: \$\{pipeline\.length\}; --pocket: \$\{pocket\.length\};"/.test(source),
      'and the page hands the stylesheet the two lane counts as custom properties - never a count written by hand, never a layout inline (#203)');
    assert(!/style="grid-/.test(source), 'no grid placement is written inline on this page');
    assert(!/flex: \d/.test(source), 'the two flex regions that wrapped onto a row each - and their ratio - are gone');
    // No caption names a group, and one line counts the board (#203): how many
    // the filters let through out of how many it holds. The picker scopes.
    assert(!/omega-tower-board__caption/.test(source), 'no caption cell names a group');
    assert(/showing \$\{shown\} out of \$\{total\}/.test(source) && !/filtered out/.test(source) && !/across every repo/.test(source),
      'the count line says "showing X out of Y" and nothing else - no scope words, the picker owns the scope');
    assert(/<div class="omega-tower-group omega-tower-group--pipeline">/.test(source), 'the pipeline is a group, placed by class');
    assert(/<aside class="omega-tower-group omega-tower-group--pocket" aria-label="Waiting/.test(source),
      'and the pocket is the second group, still a landmark of its own, placed by class');
    assert(!/<div class="card"><div class="card-body[^>]*>\$\{counts\(/.test(source), 'and no card wraps the groups (#203)');
    // Both groups are drawn by ONE lane renderer, which is what keeps a pocket
    // lane a drop target like any other - a card is dragged into and out of them.
    assertEq((source.match(/const lanes = /g) || []).length, 1, 'one lane renderer draws both groups');
    assert(!/openQuestion|omega-tower-issue__question/.test(source), 'and no card draws an open question line - that one is in the dialog it opens (#205)');

    const sheet = fs.readFileSync(path.join(src, 'css', 'main.scss'), 'utf8');
    assert(/\.omega-tower-board \{[^}]*grid-template-columns: repeat\(var\(--pipeline\), minmax\(9rem, 1fr\)\) 0 repeat\(var\(--pocket\), minmax\(9rem, 1fr\)\);/.test(sheet),
      'the strip’s tracks are read from the page’s two counts, with a zero-width spacer between the groups - one row, no caption row');
    assert(!/grid-template-rows/.test(sheet.slice(sheet.indexOf('.omega-tower-board {'), sheet.indexOf('.omega-tower-issue--dragging'))), 'and the strip has no second row');
    assert(/\.omega-tower-group \{[^}]*grid-template-columns: subgrid;/.test(sheet),
      'a group borrows the strip’s own tracks, so its lanes are the board’s lanes to the pixel');
    assert(/\.omega-tower-group--pipeline \{ grid-column: 1 \/ span var\(--pipeline\); \}/.test(sheet)
      && /\.omega-tower-group--pocket \{ grid-column: calc\(var\(--pipeline\) \+ 2\) \/ span var\(--pocket\); \}/.test(sheet),
      'and each group is placed by a class rule reading those counts, the pocket skipping the spacer track');
    assert(!/\.omega-tower-group::before/.test(sheet) && !/--bs-card-bg/.test(sheet.slice(sheet.indexOf('.omega-tower-board {'), sheet.indexOf('.omega-tower-issue--dragging'))),
      'no group wears a card face (#291)');
    assert(/\.omega-tower-group--pocket::before \{[^}]*position: absolute;[^}]*top: 0;[^}]*bottom: 0;[^}]*left: -1rem;[^}]*border-left: 1px solid/.test(sheet),
      'and the pocket is set off by one vertical hairline, standing a whole gutter from the lane on either side (#291)');
    assert(!/omega-tower-pockets/.test(sheet), 'the pocket has no rule of its own beyond its placement and its divider');
    assert(!/\.omega-tower-board \{[^}]*padding:/.test(sheet), 'and the strip carries no padding now that no card face is drawn into it');
    assert(/\.omega-tower-issue__question \{[^}]*-webkit-line-clamp: 3/.test(sheet),
      'and the question the dialog draws is clamped, so the widest one cannot crowd out the body under it');
  });

  await test('a filter never clears the view, and the view never clears a filter', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/const PARAMS = \['type', 'priority', 'agent', 'assignee', 'q'\]/.test(source),
      'the view is not one of the filter parameters writeFilters deletes what it is not given');
    assert(/writeView\(button\.dataset\.view\)/.test(source), 'the toggle writes only its own parameter');
  });

  await test('the toggle is two buttons and says which one is in force', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/aria-pressed="\$\{view === name\}"/.test(source), 'the active one is marked for a screen reader');
    assert(/btn-\$\{view === name \? '' : 'outline-'\}adaptive/.test(source), 'and drawn filled against outlined, in the theme’s own button');
    const toggle = source.slice(source.indexOf('const viewToggle'), source.indexOf('const toolbar'));
    assert(/data-view="\$\{name\}"/.test(toggle), 'each button names the view it selects');
    assert(!/style=|color:/.test(toggle), 'and nothing about it is coloured by hand - the framework’s classes are the whole of it');
  });

  await test('the graph is composed in the lib, drawn after the write, and says it is not the surface', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/import \{ boardGraph \} from '\.\.\/libs\/tower\/graphdef\.js'/.test(source), 'the definition comes from the lib');
    assert(/import \{ loadGraph, graphReady, graphSlot, drawGraph \} from '__main_assets__\/js\/libs\/graph\.js'/.test(source),
      'and the drawing from the framework’s graph module, which is the only place mermaid is named');
    assert(/definition = boardGraph\(shown, sweep\)/.test(source),
      'composed from the issues on screen and the whole sweep behind them');
    assert(/graphSlot\('board-graph', GRAPH_HEIGHT, definition\)/.test(source),
      'the slot carries the definition, which is the stamp swap compares on');
    assert(/if \(!swap\(root[\s\S]*paintGraph\(root, state, definition\)/.test(source),
      'so a repaint that wrote nothing never redraws the diagram');
    assert(/cards open in the List view/.test(source), 'and the muted line says where the board is worked');
    assert(/drawing = drawing\.then/.test(source),
      'draws are serialized so a slower old render cannot land after a newer one and stand stale');
    assert(/drawGraph\('board-graph', next\)\.catch/.test(source),
      'a definition strict mermaid refuses says so in the host instead of leaving the box blank');
    assert(/: empty\('nothing on this board waits on anything'/.test(source),
      'an edge-less board shows the empty state, never an empty diagram');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
