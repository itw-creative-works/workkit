// Tests for standards.js under a Node below the kit's floor: the floor line and
// 1, before any step of the heal. The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const { SYSTEM_PATH, NODE_DIR, joinPath } = require('../../lib/platform');
const {
  cleanup, makeRepo, makeGhStub, ghCalls, heal, claudeHomeWith,
} = require('./helpers');
const { olderNode } = require('../../lib/node-fakes');

describe('standards.js under a Node below the floor', () => {
  test('a heal of an opted-in repo: the floor line alone on stderr, exit 1, and no gh call, file, roster or link', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const home = mkTmp('wf-std-');
    const { claude } = claudeHomeWith();
    const before = fs.readdirSync(repo).sort();
    const res = heal([repo], {
      ...process.env,
      PATH: joinPath(stub.binDir, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: home,
      WORKFLOW_CLAUDE_HOME: claude,
    }, { preload: olderNode('20.15.1') });
    expect(res.status, `exit 1, got: ${res.output}`).toBe(1);
    expect(res.stderr, 'the floor line, nothing else').toBe('workkit: this Node is v20.15.1; the kit needs 22.22 or newer\n');
    expect(res.stdout, 'nothing on stdout').toBe('');
    expect(ghCalls(stub), 'no gh call').toEqual([]);
    expect(fs.readdirSync(repo).sort(), 'nothing written into the repo').toEqual(before);
    expect(fs.readdirSync(home), 'nothing written into the machine folder').toEqual([]);
    expect(fs.existsSync(path.join(claude, 'workkit')), 'no engine link').toBe(false);
    cleanup(repo); cleanup(stub.dir); cleanup(home); cleanup(path.dirname(claude));
  });
});
