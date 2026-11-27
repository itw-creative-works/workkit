// Tests for workflow/workkit/roster.js: the doctor's count of the roster file,
// the edges it keeps (a null, a false, an array, a declined
// entry, a shape it could not read), and the doctor's line for a roster that
// is not JSON. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const { attentionCount } = require('../../lib/identity');
const {
  WORKFLOW_DIR, cleanup, mkWorld, runCli, lines,
} = require('./helpers');

const { rosterCount } = require(path.join(WORKFLOW_DIR, 'workkit', 'roster.js'));

describe('roster.js: rosterCount', () => {
  test('a top-level null, and repos null or false, count 0', () => {
    for (const text of ['null', '{"repos":null}', '{"repos":false}']) {
      expect(rosterCount(text), text).toBe(0);
    }
  });

  test('repos as a list counts its elements', () => {
    expect(rosterCount('{"repos":["a","b","c"]}')).toBe(3);
  });

  test('an entry marked declined is left out of the count', () => {
    expect(rosterCount('{"version":1,"repos":{"acme/a":"enabled","acme/b":"declined","acme/c":"enabled"}}')).toBe(2);
  });

  test('any other shape, or text that is not JSON, answers null', () => {
    for (const text of ['[1,2]', '"owner/repo"', '{"repos":5}', 'not json', '']) {
      expect(rosterCount(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe('workkit doctor: a roster that is not JSON', () => {
  test('the cannot-be-read warning naming the file, exit 0, and no attention item', () => {
    const world = mkWorld();
    const file = path.join(world.workflowHome, '.repos.json');
    fs.mkdirSync(world.workflowHome, { recursive: true });
    fs.writeFileSync(file, '{"repos": {');
    const broken = runCli(world, ['doctor']);
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, repos: {} })}\n`);
    const empty = runCli(world, ['doctor']);
    cleanup(world.root);

    expect(broken.code, `exit 0, got: ${broken.said}`).toBe(0);
    const line = `⚠ roster: ${gitPath(file)} cannot be read as JSON (unreadable or not valid JSON); fix or remove it, then re-run a session in any repo`;
    expect(lines(broken.err).includes(line),`the warning, got: ${broken.said}`).toBe(true);
    // The roster report adds nothing to the doctor's count: the warning is said, never counted.
    expect(attentionCount(broken.said), `the same count as an empty roster, got: ${broken.said}`).toBe(attentionCount(empty.said));
  });
});
