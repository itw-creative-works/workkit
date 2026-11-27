// Tests for workflow/workkit/floor.js, the entry's Node floor: the line a Node
// below 22.22 gets and the code each command stops with, in this process; and the
// entry started under a Node that reads as older, so the check runs first.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../../lib/harness');
const { SYSTEM_PATH, nodeHomeEnv } = require('../../lib/platform');
const { WORKFLOW_DIR, CLI } = require('./helpers');

const { floorOf, floorLine, floorCode } = require(path.join(WORKFLOW_DIR, 'workkit', 'floor.js'));

const LINE = (version) => `workkit: this Node is ${version}; the kit needs 22.22 or newer`;

describe('floor.js', () => {
  test('the floor is the root package.json\'s engines value, 22.22', () => {
    expect(floorOf()).toEqual([22, 22]);
  });

  test('a Node below 22.22 gets the line naming its version, one at 22.22.0 or above none', () => {
    for (const version of ['v20.15.1', 'v22.21.9', 'v8.17.0']) {
      expect(floorLine(version, [22, 22]), `${version} is below the floor`).toBe(LINE(version));
    }
    for (const version of ['v22.22.0', 'v22.22.0-nightly20261101a1b2c3d4e5', 'v22.23.0', 'v23.0.0', 'v24.11.1']) {
      expect(floorLine(version, [22, 22]), `${version} is at or above the floor`).toBe('');
    }
  });

  test('review covers and proof red stop with 2, since their 1 is an answer; every other command with 1', () => {
    expect(floorCode(['review', 'covers']), 'review covers').toBe(2);
    expect(floorCode(['proof', 'red', 'src/x.js', '--', 'true']), 'proof red').toBe(2);
    for (const argv of [['review', 'mark'], ['proof'], ['doctor'], ['ship', 'watch', 'abc'], []]) {
      expect(floorCode(argv), `[${argv.join(' ')}]`).toBe(1);
    }
  });
});

describe('workkit.js under a Node below the floor', () => {
  // A node that reads as v20.15.1 to the code it runs: the check runs on that version before anything else.
  const olderNode = () => {
    const preload = path.join(mkTmp('wk-floor-'), 'older.js');
    fs.writeFileSync(preload, [
      "Object.defineProperty(process, 'version', { value: 'v20.15.1' });",
      "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '20.15.1' } });",
    ].join('\n'));
    return preload;
  };

  test('review covers prints the one line on stderr and stops with 2, doctor with 1, nothing on stdout', () => {
    const preload = olderNode();
    const env = nodeHomeEnv(mkTmp('wk-floor-home-'), { PATH: SYSTEM_PATH });
    for (const [args, code] of [[['review', 'covers'], 2], [['doctor'], 1]]) {
      const res = run(process.execPath, ['-r', preload, CLI, ...args], { env });
      expect(res.status, `${args.join(' ')}: the floor's code, got: ${res.output}`).toBe(code);
      expect(res.stderr, `${args.join(' ')}: the one line`).toBe(`${LINE('v20.15.1')}\n`);
      expect(res.stdout, `${args.join(' ')}: nothing on stdout`).toBe('');
    }
  });
});
