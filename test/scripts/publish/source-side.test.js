// Tests for workflow/publish.sh: the source side (an edit to the project
// pushed to main, a source push that does not land, and --quiet).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { cleanup, mkWorld, publish, fromPages, onMain } = require('./helpers');

describe('workflow/publish: the source side', () => {
  test('an edit to the project itself is committed and pushed to main', () => {
    const world = mkWorld();
    fs.writeFileSync(world.source, '# the tower, edited\n');
    const { code, out } = publish(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const main = onMain(world);
    expect(/edited/.test(fs.readFileSync(path.join(main, 'README.md'), 'utf8')),
      'the source change travelled with the publish').toBeTruthy();
    cleanup(world.root);
  });

  test('a source push that does not land still publishes the site, and is the exit code', () => {
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
    expect(code, `the failed push surfaces as the exit code: ${out}${err}`).toBe(1);
    expect(/could not push main/.test(out + err), `the failure is said out loud, got: ${out}${err}`).toBeTruthy();
    const pages = fromPages(world);
    expect(pages, 'the site still published').toBeTruthy();
    expect(fs.existsSync(path.join(pages, 'index.html')), 'and carries the build').toBeTruthy();
    cleanup(world.root);
  });

  test('--quiet says nothing when there is nothing to report', () => {
    const world = mkWorld({ home: false });
    const { code, out } = publish(world, ['--quiet']);
    expect(code, 'exit 0').toBe(0);
    expect(out, `the daily job's log stays clean, got: ${out}`).toBe('');
    cleanup(world.root);
  });
});
