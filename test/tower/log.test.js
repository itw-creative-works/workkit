//
// Tests for tower/api/lib/log.js in a real piped node (the no-tty branch; the
// WORKKIT_COLOR seam asks for styling). test/scripts/lib-log.test.js is the shell half.
//

const { spawnSync } = require('child_process');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun, SPAWN_DEADLINE } = require('../lib/harness');

const LOG = path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'log.js');
const ESCAPE = '\u001b';

/** Run one line of node with the logger required, stdout and stderr piped. */
const inNode = (script, env = {}) => {
  const res = spawnSync(process.execPath, ['-e', `const { createLogger } = require(${JSON.stringify(LOG)});\n${script}`], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `node finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const EVERY_LEVEL = "const l = createLogger();\nl.ok('board: swept');\nl.skip('board: current');\n"
  + "l.info('board: a hint');\nl.warn('board: careful');\nl.error('board: broken');";

const cases = async () => {
  group('tower/api/lib/log: the glyphs');

  await test('every level opens with its own glyph', () => {
    const { out, err } = inNode(EVERY_LEVEL);
    assertEq(out, '✓ board: swept\n· board: current\n› board: a hint\n',
      `the calm levels, one glyph each, got: ${JSON.stringify(out)}`);
    assertEq(err, '⚠ board: careful\n✖ board: broken\n',
      `and the loud ones, got: ${JSON.stringify(err)}`);
  });

  await test('the calm levels go to stdout and the loud ones to stderr', () => {
    const { out, err } = inNode(
      "const l = createLogger();\nl.ok('listening');\nl.warn('careful');\nl.error('broken');",
    );
    assert(/listening/.test(out) && !/careful|broken/.test(out), `stdout carries the calm one alone, got: ${out}`);
    assert(/careful/.test(err) && /broken/.test(err), `and the loud ones are on stderr, got: ${err}`);
  });

  group('tower/api/lib/log: the task and the colors');

  await test('the first `word:` of a message is split off and painted bold', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '1' });
    assertEq(out, `${ESCAPE}[1m${ESCAPE}[0;32m✓${ESCAPE}[0m ${ESCAPE}[1mboard:${ESCAPE}[0m swept\n`,
      `a bold glyph, a bold task, a plain message, got: ${JSON.stringify(out)}`);
  });

  await test('a message with no such opening prints as it was written', () => {
    const { out } = inNode("createLogger().ok('listening on http://127.0.0.1:8693');", { WORKKIT_COLOR: '0' });
    assertEq(out, '✓ listening on http://127.0.0.1:8693\n',
      `nothing is split off a URL, got: ${JSON.stringify(out)}`);
  });

  await test('a pipe gets no escape, however loud the level', () => {
    const { out, err } = inNode(EVERY_LEVEL);
    assert(!`${out}${err}`.includes(ESCAPE), `nothing is styled off a terminal, got: ${JSON.stringify(out + err)}`);
  });

  await test('NO_COLOR beats the seam, the way it does in the shell half', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '1', NO_COLOR: '1' });
    assert(!out.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out)}`);
    assertEq(out, '✓ board: swept\n', `and the words are the same, got: ${JSON.stringify(out)}`);
  });

  await test('a TERM that cannot render it is a final no too, as in the shell half', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '1', TERM: 'dumb' });
    assert(!out.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out)}`);
    assertEq(out, '✓ board: swept\n', `and the words are the same, got: ${JSON.stringify(out)}`);
  });

  await test('WORKKIT_COLOR=0 is a final no as well', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '0' });
    assert(!out.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out)}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
