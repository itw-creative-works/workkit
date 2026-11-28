// Tests for workflow/publish.js under a Node below the kit's floor: the floor
// line and 1, before any step of the publish. The shared prologue is ./helpers.js.

const { describe, test, expect, run } = require('../../lib/harness');
const { cleanup, git, mkWorld, publishArgv, fromPages } = require('./helpers');
const { olderNode } = require('../../lib/node-fakes');

describe('workflow/publish under a Node below the floor', () => {
  test('a publish that would push: the floor line alone on stderr, exit 1, and no gh call, build, push or worktree', () => {
    const world = mkWorld();
    const head = git(world.tower, 'rev-parse', 'HEAD').stdout;
    const res = run(process.execPath, publishArgv(world, [], olderNode('20.15.1')), { env: world.env });
    expect(res.status, `exit 1, got: ${res.output}`).toBe(1);
    expect(res.stderr, 'the floor line, nothing else').toBe('workkit: this Node is v20.15.1; the kit needs 22.22 or newer\n');
    expect(res.stdout, 'nothing on stdout').toBe('');
    expect(world.ghCalls(), 'no gh call').toEqual([]);
    expect(world.buildPrefix(), 'no build').toBe(null);
    expect(fromPages(world), 'nothing pushed to gh-pages').toBe(null);
    expect(git(world.tower, 'rev-parse', 'HEAD').stdout, 'the home clone where it was').toBe(head);
    expect(git(world.tower, 'worktree', 'list').stdout.trim().split('\n').length, 'and no worktree made').toBe(1);
    cleanup(world.root);
  });
});
