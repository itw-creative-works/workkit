//
// Tests for workflow/lib.sh's voice and spinner (issue #237): the one home of
// everything the engine, the jobs and the tower say to a person.
//
// Every case sources the real library in a real bash and reads what it printed,
// because the whole subject here is the bytes on the two streams: the glyph a
// level opens with, the bold `task:`, the indent under a section, which stream
// a level lands on, whether a color was used, and whether a wrapped command's
// stdout and exit status came through untouched. WORKKIT_COLOR is the seam that
// lets a pipe read the styled shape back; nothing else is stubbed, and nothing
// here touches a file or the network.
//

const { spawnSync } = require('child_process');
const path = require('path');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib.sh');
const ESCAPE = '\u001b';

// One line of every level, in the order the table lists them.
const EVERY_LEVEL = 'wk_ok "engine: linked"\nwk_skip "engine: current"\nwk_info "engine: a hint"\n'
  + 'wk_warn "engine: careful"\nwk_error "engine: broken"';

/**
 * Source lib.sh and run one line of shell in it, the way every caller uses it.
 * A real TERM, so an escape that reaches a pipe here is the color gate's doing
 * rather than the dumb-TERM check answering for it.
 */
const inLib = (script, env = {}) => {
  const res = spawnSync('bash', ['-c', `. ${JSON.stringify(LIB)}\n${script}`], {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, TERM: 'xterm-256color', ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const run = async () => {
  group('lib.sh: the glyphs');

  await test('every level opens with its own glyph', () => {
    const { out, err } = inLib(EVERY_LEVEL, { WORKKIT_COLOR: '0' });
    assertEq(out, '✓ engine: linked\n· engine: current\n› engine: a hint\n',
      `the calm levels, one glyph each, got: ${JSON.stringify(out)}`);
    assertEq(err, '⚠ engine: careful\n✖ engine: broken\n',
      `and the loud ones, got: ${JSON.stringify(err)}`);
  });

  await test('the calm levels go to stdout and the loud ones to stderr', () => {
    const { out, err } = inLib(EVERY_LEVEL, { WORKKIT_COLOR: '0' });
    assert(/linked/.test(out) && /current/.test(out) && /hint/.test(out),
      `an action, a skip and a note are on stdout, got: ${out}`);
    assert(!/careful|broken/.test(out), `and a warning is not, got: ${out}`);
    assert(/careful/.test(err) && /broken/.test(err), `a warning and an error are on stderr, got: ${err}`);
  });

  await test('a title is bold and a section is bold cyan under a blank line', () => {
    const { out } = inLib('wk_title "🧰 workkit setup in /tmp"\nwk_section "💻 This machine"',
      { WORKKIT_COLOR: '1' });
    assertEq(out, `${ESCAPE}[1m🧰 workkit setup in /tmp${ESCAPE}[0m\n`
      + `\n${ESCAPE}[1m${ESCAPE}[0;36m💻 This machine${ESCAPE}[0m\n`,
      `the two headings, got: ${JSON.stringify(out)}`);
  });

  await test('the closing line is the ✨ one, and an emoji survives a pipe', () => {
    const { out } = inLib('wk_done "Everything this command can see is current."', { WORKKIT_COLOR: '0' });
    assertEq(out, '✨ Everything this command can see is current.\n',
      `the closing line, uncolored, got: ${JSON.stringify(out)}`);
  });

  group('lib.sh: the task and the indent');

  await test('the first `word:` of a message is split off and painted bold', () => {
    const { out } = inLib('wk_ok "engine: linked a → b"', { WORKKIT_COLOR: '1' });
    assertEq(out, `${ESCAPE}[1m${ESCAPE}[0;32m✓${ESCAPE}[0m ${ESCAPE}[1mengine:${ESCAPE}[0m linked a → b\n`,
      `a bold glyph, a bold task, a plain message, got: ${JSON.stringify(out)}`);
  });

  await test('a message with no such opening prints as it was written', () => {
    const { out } = inLib('wk_ok "linked two things: one and the other"', { WORKKIT_COLOR: '1' });
    assertEq(out, `${ESCAPE}[1m${ESCAPE}[0;32m✓${ESCAPE}[0m linked two things: one and the other\n`,
      `nothing is split off a sentence, got: ${JSON.stringify(out)}`);
  });

  await test('the same line off a terminal is the same words with no codes', () => {
    const { out } = inLib('wk_ok "engine: linked a → b"', { WORKKIT_COLOR: '0' });
    assertEq(out, '✓ engine: linked a → b\n', `byte for byte minus the codes, got: ${JSON.stringify(out)}`);
  });

  await test('a warning paints its glyph, its task and its message', () => {
    const { err } = inLib('wk_warn "gh: not installed"', { WORKKIT_COLOR: '1' });
    assertEq(err, `${ESCAPE}[0;33m⚠${ESCAPE}[0m ${ESCAPE}[1m${ESCAPE}[0;33mgh:${ESCAPE}[0m `
      + `${ESCAPE}[0;33mnot installed${ESCAPE}[0m\n`,
      `yellow throughout, the task bold, got: ${JSON.stringify(err)}`);
  });

  await test('a skip is dim from end to end', () => {
    const { out } = inLib('wk_skip "engine: current"', { WORKKIT_COLOR: '1' });
    assertEq(out, `${ESCAPE}[0;90m·${ESCAPE}[0m ${ESCAPE}[0;90mengine:${ESCAPE}[0m `
      + `${ESCAPE}[0;90mcurrent${ESCAPE}[0m\n`,
      `the whole line dim, got: ${JSON.stringify(out)}`);
  });

  await test('a level line under a title or a section is indented two spaces', () => {
    const { out } = inLib('wk_ok "engine: before"\nwk_title "🧰 workkit setup in /tmp"\nwk_ok "engine: after"\n'
      + 'wk_section "💻 This machine"\nwk_skip "engine: under the section"', { WORKKIT_COLOR: '0' });
    const said = out.split('\n');
    assertEq(said[0], '✓ engine: before', `a line before any title is flush left, got: ${JSON.stringify(said[0])}`);
    assertEq(said[2], '  ✓ engine: after', `and a line under the title is indented, got: ${JSON.stringify(said[2])}`);
    assertEq(said[5], '  · engine: under the section',
      `as is a line under a section, got: ${JSON.stringify(said[5])}`);
  });

  await test('NO_COLOR beats the seam that asked for color', () => {
    const { out, err } = inLib('wk_ok "engine: linked"\nwk_warn "gh: careful"',
      { WORKKIT_COLOR: '1', NO_COLOR: '1' });
    assert(!`${out}${err}`.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out + err)}`);
    assertEq(out, '✓ engine: linked\n', `and the words are the same, got: ${JSON.stringify(out)}`);
  });

  group('lib.sh: QUIET and the stderr caller');

  await test('QUIET silences everything but an action, a warning and a stop', () => {
    const { out, err } = inLib(
      'QUIET=1\nwk_title "🧰 a title"\nwk_section "💻 a section"\nwk_skip "engine: current"\n'
      + 'wk_info "engine: a hint"\nwk_done "all current"\nwk_ok "engine: linked"\nwk_warn "gh: careful"',
      { WORKKIT_COLOR: '0' },
    );
    assertEq(out, '  ✓ engine: linked\n', `one line left on stdout, the action, got: ${JSON.stringify(out)}`);
    assertEq(err, '  ⚠ gh: careful\n', `and the warning still speaks, got: ${JSON.stringify(err)}`);
  });

  await test('WK_LOG_STDERR sends every level to stderr, for a caller whose stdout is an answer', () => {
    const { out, err } = inLib(
      'WK_LOG_STDERR=1\nwk_ok "engine: linked"\nwk_skip "engine: current"\nwk_section "💻 This machine"\n'
      + 'wk_warn "gh: careful"\nprintf "%s\\n" enabled',
      { WORKKIT_COLOR: '0' },
    );
    assertEq(out, 'enabled\n', `stdout carries the answer and nothing else, got: ${JSON.stringify(out)}`);
    assertEq(err.split('\n').filter(Boolean).length, 4, `and every level is on stderr, got: ${JSON.stringify(err)}`);
  });

  group('lib.sh: wk_spin');

  await test("the wrapped command's stdout passes through a capture untouched", () => {
    const { out } = inLib(
      'answer="$(wk_spin "reading the roster" printf "%s" "owner/repo")"\nprintf "[%s]\\n" "$answer"',
      { WORKKIT_COLOR: '0', WORKKIT_SPIN: '0' },
    );
    assertEq(out, '[owner/repo]\n', `the capture holds the answer alone, got: ${JSON.stringify(out)}`);
  });

  await test('and so does its exit status', () => {
    const { out } = inLib(
      'rc=0\nwk_spin "trying" bash -c "exit 3" || rc=$?\nprintf "rc=%s\\n" "$rc"',
      { WORKKIT_COLOR: '0', WORKKIT_SPIN: '0' },
    );
    assert(/rc=3/.test(out), `the command's own status, got: ${JSON.stringify(out)}`);
  });

  await test('off a terminal it says what it is waiting for once, on stderr', () => {
    const { out, err } = inLib('wk_spin "reading the roster" true', { WORKKIT_COLOR: '0' });
    assertEq(out, '', `nothing on stdout, which belongs to the command, got: ${JSON.stringify(out)}`);
    assertEq(err, '⏳ reading the roster...\n', `the static form, with no animation, got: ${JSON.stringify(err)}`);
  });

  await test('the static line is indented with the steps around it', () => {
    const { err } = inLib('wk_section "💻 This machine"\nwk_spin "reading the roster" true',
      { WORKKIT_COLOR: '0' });
    assertEq(err, '  ⏳ reading the roster...\n', `under the section, got: ${JSON.stringify(err)}`);
  });

  await test('QUIET silences the static line too, and never the command', () => {
    const { out, err } = inLib(
      'QUIET=1\nanswer="$(wk_spin "reading the roster" printf "%s" ok)"\nprintf "[%s]\\n" "$answer"',
      { WORKKIT_COLOR: '0' },
    );
    assertEq(err, '', `a quiet run waits in silence, got: ${JSON.stringify(err)}`);
    assertEq(out, '[ok]\n', `and still gets the answer, got: ${JSON.stringify(out)}`);
  });

  group('lib.sh: wk_plain');

  await test('a relayed line loses the indent and the glyph it arrived with, and nothing else', () => {
    const { out } = inLib(
      'printf "%s\\n" "  ✓ engine: linked a → b" "· engine: current" "plain line" | wk_plain',
      { WORKKIT_COLOR: '0' },
    );
    assertEq(out, 'engine: linked a → b\nengine: current\nplain line\n',
      `only the opening goes, got: ${JSON.stringify(out)}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
