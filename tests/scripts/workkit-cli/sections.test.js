//
// Tests for workflow/workkit.sh: how a run is organized: titled
// sections, and color only at a terminal that wants it.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const fs = require('fs');
const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkWorld, runCli, mkKit, SLUG, mkHomeWorld } = require('./helpers');

const run = async () => {
  group('workkit: how a run is organized (issue #90)');

  // The escape byte every color code starts with. Nothing this command prints
  // to a pipe may contain one: the standards hook relays `update --auto` into a
  // session's context, and the log files keep the rest.
  const ESCAPE = '\u001b';
  // Where a section title sits in a transcript: a blank line, then the title
  // with its emoji (issue #237) and nothing else.
  const sectionAt = (text, title) => text.search(new RegExp(`\n\n${title}\n`));
  const SETUP_SECTIONS = ['💻 This machine', '🏠 Home repo', '🔑 Cloud brief secrets', '🌐 Dashboard site', '📁 This repo'];
  const DOCTOR_SECTIONS = ['💻 This machine', '🏠 Home repo', '🔑 Cloud brief secrets', '📁 This repo'];

  await test('a piped run is grouped into titled sections and carries no color', () => {
    const world = mkWorld();
    // A real TERM, so escape-free output here is the tty gate's doing, with no
    // TERM at all bash reports `dumb` and the dumb-TERM check would pass this
    // test with the tty gate deleted.
    const { out } = runCli(world, ['doctor'], { env: { TERM: 'xterm-256color' } });
    assert(!out.includes(ESCAPE), `no escape sequence reaches a pipe, got: ${JSON.stringify(out)}`);
    for (const title of DOCTOR_SECTIONS) {
      assert(sectionAt(out, title) > -1, `"${title}" is a section, with a blank line before it, got: ${out}`);
    }
    cleanup(world.root);
  });

  await test('setup names its sections in the order it runs them', () => {
    const world = mkHomeWorld({ secrets: [] });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    let at = -1;
    for (const title of SETUP_SECTIONS) {
      const next = sectionAt(out, title);
      assert(next > at, `"${title}" comes after the section before it, got: ${out}`);
      at = next;
    }
    cleanup(world.root); cleanup(kit);
  });

  // The terminal this suite cannot be: the seam stands in for the tty, and TERM
  // is named because a shell handed no environment reports `dumb`.
  const AT_A_TERMINAL = { WORKKIT_COLOR: '1', TERM: 'xterm-256color' };

  await test('at a terminal the section headers are styled and the glyphs colored', () => {
    const world = mkWorld();
    const { out, err } = runCli(world, ['doctor'], { env: AT_A_TERMINAL });
    // The line shape, in color (issue #237): a section title in bold cyan, one
    // blank line above it, its emoji riding along.
    assert(out.includes(`\n\n${ESCAPE}[1m${ESCAPE}[0;36m💻 This machine${ESCAPE}[0m\n`),
      `the header is bold and colored, got: ${JSON.stringify(out)}`);
    // A warning wears its color on the glyph, the task and the message alike.
    assert(err.includes(`${ESCAPE}[0;33m⚠${ESCAPE}[0m`), `a warning's glyph is yellow, got: ${JSON.stringify(err)}`);
    cleanup(world.root);
  });

  await test('a machine that asked for no color gets none, however it asked', () => {
    // Each no is final, even against the seam that asked for color, because a
    // machine saying NO_COLOR is answering for every tool on it.
    for (const [why, env] of [
      ['NO_COLOR is set', { ...AT_A_TERMINAL, NO_COLOR: '1' }],
      ['the terminal is dumb', { ...AT_A_TERMINAL, TERM: 'dumb' }],
      ['color was switched off', { ...AT_A_TERMINAL, WORKKIT_COLOR: '0' }],
    ]) {
      const world = mkWorld();
      const { out } = runCli(world, ['doctor'], { env });
      assert(!out.includes(ESCAPE), `${why}: nothing is styled, got: ${JSON.stringify(out)}`);
      assert(sectionAt(out, '💻 This machine') > -1, `${why}: and the grouping is still there, got: ${out}`);
      cleanup(world.root);
    }
  });

  await test('update --auto gains no header, no blank line, and no color', () => {
    // The session-start injection stays terse: whatever a human's run looks
    // like, the automatic one is the lines it changed and nothing around them.
    for (const [where, env] of [['a session start', {}], ['a terminal', AT_A_TERMINAL]]) {
      const world = mkWorld();
      fs.mkdirSync(world.localBin, { recursive: true });
      const { out } = runCli(world, ['update', '--auto'], { env });
      assert(out.includes('command:'), `${where}: it still reports what it did, got: ${out}`);
      if (env !== AT_A_TERMINAL) assert(!out.includes(ESCAPE), `${where}: and says it plainly, got: ${JSON.stringify(out)}`);
      assert(!/\n\s*\n/.test(out), `no blank line, got: ${JSON.stringify(out)}`);
      for (const title of SETUP_SECTIONS) {
        assert(!out.includes(title), `no "${title}" header, got: ${out}`);
      }
      assert(!out.includes('workkit update in'), `and no title line, got: ${out}`);
      cleanup(world.root);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
