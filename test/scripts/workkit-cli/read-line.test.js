// Tests for readLine of workflow/lib/flows.js, the line a question after a yes
// reads (the site's custom domain): in a node of its own whose stdin is a file,
// askYes first, then readLine on what it left unread.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { SYSTEM_PATH, nodeHomeEnv, jsPath, spawnSync } = require('../../lib/platform');
const { WORKFLOW_DIR } = require('./helpers');

// The caller: the yes or no question, then the line, both answers on stdout as JSON.
const CALLER = [
  `const { askYes, readLine } = require(${jsPath(path.join(WORKFLOW_DIR, 'lib', 'flows.js'))});`,
  '(async () => {',
  "  const yes = await askYes('Publish the dashboard site to GitHub Pages?', 'n');",
  '  const line = await readLine();',
  '  process.stdout.write(JSON.stringify({ yes, line }));',
  '})();',
].join('\n');

/** askYes then readLine in a node of its own, stdin a file holding <input>. */
const asked = (input) => {
  const dir = mkTmp('wk-read-line-');
  const stdin = path.join(dir, 'stdin');
  fs.writeFileSync(stdin, input);
  const fd = fs.openSync(stdin, 'r');
  const res = spawnSync(process.execPath, ['-e', CALLER], {
    env: nodeHomeEnv(dir, { PATH: SYSTEM_PATH }), stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  fs.closeSync(fd);
  expect(res.status, `the caller ends clean, got: ${res.stdout}${res.stderr}`).toBe(0);
  return JSON.parse(res.stdout);
};

describe('flows.js: readLine after askYes', () => {
  test('the line after the yes is the answer', () => {
    expect(asked('y\ntower.example.com\n')).toEqual({ yes: true, line: 'tower.example.com' });
  });

  test('a last line with no newline is still answered whole', () => {
    expect(asked('y\ntower.example.com')).toEqual({ yes: true, line: 'tower.example.com' });
  });

  test('at the end of input with nothing left it answers an empty line', () => {
    expect(asked('y\n')).toEqual({ yes: true, line: '' });
  });
});
