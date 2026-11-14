//
// Tests for tower/api/lib/log.js in a real piped node (the no-tty branch; the
// WORKKIT_COLOR seam asks for styling). test/scripts/lib-log.test.js is the shell half.
//

const { spawnSync } = require('child_process');
const path = require('path');
const { describe, test, expect, SPAWN_DEADLINE } = require('../lib/harness');

const LOG = path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'log.js');
const ESCAPE = '\u001b';

/** Run one line of node with the logger required, stdout and stderr piped. */
const inNode = (script, env = {}) => {
  const res = spawnSync(process.execPath, ['-e', `const { createLogger } = require(${JSON.stringify(LOG)});\n${script}`], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `node finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const EVERY_LEVEL = "const l = createLogger();\nl.ok('board: swept');\nl.skip('board: current');\n"
  + "l.info('board: a hint');\nl.warn('board: careful');\nl.error('board: broken');";

describe('tower/api/lib/log: the glyphs', () => {
  test('every level opens with its own glyph', () => {
    const { out, err } = inNode(EVERY_LEVEL);
    expect(out, `the calm levels, one glyph each, got: ${JSON.stringify(out)}`).toBe('✓ board: swept\n· board: current\n› board: a hint\n');
    expect(err, `and the loud ones, got: ${JSON.stringify(err)}`).toBe('⚠ board: careful\n✖ board: broken\n');
  });

  test('the calm levels go to stdout and the loud ones to stderr', () => {
    const { out, err } = inNode(
      "const l = createLogger();\nl.ok('listening');\nl.warn('careful');\nl.error('broken');",
    );
    expect(/listening/.test(out) && !/careful|broken/.test(out), `stdout carries the calm one alone, got: ${out}`).toBeTruthy();
    expect(/careful/.test(err) && /broken/.test(err), `and the loud ones are on stderr, got: ${err}`).toBeTruthy();
  });
});

describe('tower/api/lib/log: the task and the colors', () => {
  test('the first `word:` of a message is split off and painted bold', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '1' });
    expect(out, `a bold glyph, a bold task, a plain message, got: ${JSON.stringify(out)}`).toBe(`${ESCAPE}[1m${ESCAPE}[0;32m✓${ESCAPE}[0m ${ESCAPE}[1mboard:${ESCAPE}[0m swept\n`);
  });

  test('a message with no such opening prints as it was written', () => {
    const { out } = inNode("createLogger().ok('listening on http://127.0.0.1:8693');", { WORKKIT_COLOR: '0' });
    expect(out, `nothing is split off a URL, got: ${JSON.stringify(out)}`).toBe('✓ listening on http://127.0.0.1:8693\n');
  });

  test('a pipe gets no escape, however loud the level', () => {
    const { out, err } = inNode(EVERY_LEVEL);
    expect(!`${out}${err}`.includes(ESCAPE), `nothing is styled off a terminal, got: ${JSON.stringify(out + err)}`).toBeTruthy();
  });

  test('NO_COLOR beats the seam, the way it does in the shell half', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '1', NO_COLOR: '1' });
    expect(!out.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out)}`).toBeTruthy();
    expect(out, `and the words are the same, got: ${JSON.stringify(out)}`).toBe('✓ board: swept\n');
  });

  test('a TERM that cannot render it is a final no too, as in the shell half', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '1', TERM: 'dumb' });
    expect(!out.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out)}`).toBeTruthy();
    expect(out, `and the words are the same, got: ${JSON.stringify(out)}`).toBe('✓ board: swept\n');
  });

  test('WORKKIT_COLOR=0 is a final no as well', () => {
    const { out } = inNode("createLogger().ok('board: swept');", { WORKKIT_COLOR: '0' });
    expect(!out.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out)}`).toBeTruthy();
  });
});
