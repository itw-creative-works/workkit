//
// Tests for workflow/discussions.sh: posting a summary and reading summaries back.
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkWorld, inHome } = require('./helpers');

const run = async () => {
  group('workflow/discussions: posting and reading back');

  await test('a summary is posted, and the discussion URL comes back', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const body = path.join(world.root, 'summary.md');
    fs.writeFileSync(body, '## Went well\nA day.\n');
    const { code, out } = inHome(world, [
      'wk_disc_resolve_category owner/workkit Daily',
      `wk_disc_create owner/workkit "$WK_DISC_CATEGORY_ID" "daily: 2026-07-28" ${JSON.stringify(body)}`,
    ].join('\n'));
    assertEq(code, 0, 'exit 0');
    assert(/discussions\/3/.test(out), `the URL is what a caller logs, got: ${out}`);
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('createDiscussion'));
    assert(posted.includes(`body=@${body}`), `the body is sent from a file, never as an argument: ${posted}`);
    cleanup(world.root);
  });

  await test('a rollup reads prior summaries back, and the window is applied here', () => {
    // The API takes no date argument (only an order) so the period is a
    // filter on what came back, not a query the server ran.
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { code, out } = inHome(world, 'wk_disc_list owner/workkit Daily 2026-07-21T00:00:00Z');
    assertEq(code, 0, 'exit 0');
    const listed = JSON.parse(out.trim());
    assertEq(listed.length, 1, `only the summaries inside the window: ${out}`);
    assertEq(listed[0].body, 'yesterday', 'and they carry their bodies for the rollup to read');
    cleanup(world.root);
  });

  await test('the resolution falls back to the default category, and says which', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    const { out } = inHome(world, 'wk_disc_resolve_category owner/workkit Weekly\nprintf "%s %s\\n" "$WK_DISC_CATEGORY_NAME" "$WK_DISC_CATEGORY_ID"');
    assert(/^General DIC_0$/m.test(out.trim()), `the caller learns both name and id, got: ${out}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
