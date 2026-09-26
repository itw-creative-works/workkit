//
// Tests for workflow/publish.sh: the source side (an edit to the project
// pushed to main, a source push that does not land, and --quiet).
// The shared prologue (the world factory, the publish runner, the settings and branch readers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkWorld, publish, fromPages, onMain } = require('./helpers');

const run = async () => {
  group('workflow/publish: the source side');

  await test('an edit to the project itself is committed and pushed to main', () => {
    const world = mkWorld();
    fs.writeFileSync(world.source, '# the tower, edited\n');
    const { code, out } = publish(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const main = onMain(world);
    assert(/edited/.test(fs.readFileSync(path.join(main, 'README.md'), 'utf8')),
      'the source change travelled with the publish');
    cleanup(world.root);
  });

  await test('a source push that does not land still publishes the site, and is the exit code', () => {
    const world = mkWorld();
    // A remote that refuses every ref but the published branch: the source
    // push cannot land, the pages push can.
    const hook = path.join(world.bare, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, [
      '#!/bin/sh',
      'while read old new ref; do',
      '  [ "$ref" = "refs/heads/gh-pages" ] || exit 1',
      'done',
      'exit 0',
      '',
    ].join('\n'));
    fs.chmodSync(hook, 0o755);
    fs.writeFileSync(world.source, '# the tower, edited\n');
    const { code, out, err } = publish(world);
    assertEq(code, 1, `the failed push surfaces as the exit code: ${out}${err}`);
    assert(/could not push main/.test(out + err), `the failure is said out loud, got: ${out}${err}`);
    const pages = fromPages(world);
    assert(pages, 'the site still published');
    assert(fs.existsSync(path.join(pages, 'index.html')), 'and carries the build');
    cleanup(world.root);
  });

  await test('--quiet says nothing when there is nothing to report', () => {
    const world = mkWorld({ home: false });
    const { code, out } = publish(world, ['--quiet']);
    assertEq(code, 0, 'exit 0');
    assertEq(out, '', `the daily job's log stays clean, got: ${out}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
