//
// Tests for tower/start.js: the Node floor it checks before anything else, under
// a node that reads as older than the kit's floor. Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const { olderNode } = require('../../lib/node-fakes');
const {
  cleanup, until, start, nodeCmd,
} = require('./helpers');

// A half that marks <file> the moment it starts, then holds.
const marking = (file) => nodeCmd("require('fs').writeFileSync(process.argv[1], ''); setTimeout(() => {}, 30000);", file);

describe('tower/start: the Node floor', () => {
  test('started on a Node below the floor: the floor line on stderr and 1, with neither half started', async () => {
    const dir = mkTmp('tower-start-floor-');
    const marks = [path.join(dir, 'api.started'), path.join(dir, 'app.started')];
    // Every node under the run reads as older; the halves still mark, since they check no floor.
    const older = olderNode('20.15.1', dir);
    const tower = start(dir, marking(marks[0]), marking(marks[1]), '', { env: { NODE_OPTIONS: `--require ${older}` } });
    try {
      const { status } = await tower.done;
      expect(status, `the floor's code: ${tower.output()}`).toBe(1);
      expect(tower.stderr(), 'the one line').toBe('workkit: this Node is v20.15.1; the kit needs 22.22 or newer\n');
      expect(tower.stdout(), 'nothing on stdout').toBe('');
      expect(await until(() => marks.some((mark) => fs.existsSync(mark)), 1000), 'and no half started').toBe(false);
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });
});
