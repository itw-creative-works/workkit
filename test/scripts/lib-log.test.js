// Tests for workflow/lib.sh's voice and spinner (workflow/lib/voice.sh): the one
// home of everything the engine, the jobs and the tower say to a person. Every
// case reads the bytes a real bash printed; WORKKIT_COLOR lets a pipe read the
// styled shape back, and nothing else is stubbed.

const { spawnSync } = require('child_process');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, SYSTEM_PATH, NO_RC, shellPath } = require('../lib/platform');
const { SPAWN_DEADLINE } = require('../lib/process');

const LIB = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib.sh'));
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
  const res = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(LIB)}\n${script}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(process.env.HOME), TERM: 'xterm-256color', ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
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

  await test('the closing line is the ✨ one, and an emoji survives a pipe', () => {
    const { out } = inLib('wk_done "Everything this command can see is current."', { WORKKIT_COLOR: '0' });
    assertEq(out, '✨ Everything this command can see is current.\n',
      `the closing line, uncolored, got: ${JSON.stringify(out)}`);
  });

  group('lib.sh: the task and the indent');

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

if (require.main === module) selfRun(run);
